import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { defaultCount, statusMap } from '@server/constants';
import { PrismaService } from '@server/prisma/prisma.service';
import { TRPCError, initTRPC } from '@trpc/server';
import Axios, { AxiosInstance } from 'axios';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

/**
 * 读书账号每日小黑屋
 */
const blockedAccountsMap = new Map<string, string[]>();

@Injectable()
export class TrpcService {
  trpc = initTRPC.create();
  publicProcedure = this.trpc.procedure;
  protectedProcedure = this.trpc.procedure.use(({ ctx, next }) => {
    const errorMsg = (ctx as any).errorMsg;
    if (errorMsg) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: errorMsg });
    }
    return next({ ctx });
  });
  router = this.trpc.router;
  mergeRouters = this.trpc.mergeRouters;
  request: AxiosInstance;
  updateDelayTime = 60;

  private readonly logger = new Logger(this.constructor.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {
    const { url } =
      this.configService.get<ConfigurationType['platform']>('platform')!;
    this.updateDelayTime =
      this.configService.get<ConfigurationType['feed']>(
        'feed',
      )!.updateDelayTime;

    this.request = Axios.create({ baseURL: url, timeout: 15 * 1e3 });

    this.request.interceptors.response.use(
      (response) => {
        return response;
      },
      async (error) => {
        this.logger.log('error: ', error);
        const errMsg = error.response?.data?.message || '';

        const id = (error.config.headers as any).xid;
        if (errMsg.includes('WeReadError401')) {
          // 账号失效
          await this.prismaService.account.update({
            where: { id },
            data: { status: statusMap.INVALID },
          });
          this.logger.error(`账号（${id}）登录失效，已禁用`);
        } else if (errMsg.includes('WeReadError429')) {
          //TODO 处理请求频繁
          this.logger.error(`账号（${id}）请求频繁，打入小黑屋`);
        }

        const today = this.getTodayDate();

        const blockedAccounts = blockedAccountsMap.get(today) || [];

        if (errMsg.includes('WeReadError400')) {
          this.logger.error(`账号（${id}）处理请求参数出错`);
          this.logger.error('WeReadError400: ', errMsg);
          // 10s 后重试
          await new Promise((resolve) => setTimeout(resolve, 10 * 1e3));
        } else if (errMsg.includes('WeReadError429')) {
          // 处理请求频繁，将账号加入小黑屋
          this.logger.warn(`账号（${id}）请求频繁，打入小黑屋24小时`);
          if (id && !blockedAccounts.includes(id)) {
            blockedAccounts.push(id);
            blockedAccountsMap.set(today, blockedAccounts);
          }
        } else {
          this.logger.error("Can't handle this error: ", errMsg);
          // 对于未知错误，也短暂加入小黑屋避免被封
          if (id && errMsg.includes('WeReadError')) {
            if (!blockedAccounts.includes(id)) {
              blockedAccounts.push(id);
              blockedAccountsMap.set(today, blockedAccounts);
            }
          }
        }

        return Promise.reject(error);
      },
    );
  }

  removeBlockedAccount = (vid: string) => {
    const today = this.getTodayDate();

    const blockedAccounts = blockedAccountsMap.get(today);
    if (Array.isArray(blockedAccounts)) {
      const newBlockedAccounts = blockedAccounts.filter((id) => id !== vid);
      blockedAccountsMap.set(today, newBlockedAccounts);
    }
  };

  private getTodayDate() {
    return dayjs.tz(new Date(), 'Asia/Shanghai').format('YYYY-MM-DD');
  }

  getBlockedAccountIds() {
    const today = this.getTodayDate();
    const disabledAccounts = blockedAccountsMap.get(today) || [];
    this.logger.debug('disabledAccounts: ', disabledAccounts);
    return disabledAccounts.filter(Boolean);
  }

  private async getAvailableAccount() {
    const disabledAccounts = this.getBlockedAccountIds();
    const account = await this.prismaService.account.findMany({
      where: {
        status: statusMap.ENABLE,
        NOT: {
          id: { in: disabledAccounts },
        },
      },
      take: 10,
    });

    if (!account || account.length === 0) {
      throw new Error('暂无可用读书账号!');
    }

    return account[Math.floor(Math.random() * account.length)];
  }

  async getMpArticles(mpId: string, page = 1, retryCount = 3) {
    const account = await this.getAvailableAccount();

    try {
      const res = await this.request
        .get<
          {
            id: string;
            title: string;
            picUrl: string;
            publishTime: number;
          }[]
        >(`/api/v2/platform/mps/${mpId}/articles`, {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
          params: {
            page,
          },
          timeout: 20000,
        })
        .then((res) => res.data)
        .then((res) => {
          this.logger.log(
            `getMpArticles(${mpId}) page: ${page} articles: ${(res as any).length}`,
          );
          return res;
        });
      return res;
    } catch (err) {
      // 只对网络错误或服务器错误重试，不对客户端错误重试
      const error = err as any;
      const isRetryableError =
        error.code === 'ECONNABORTED' ||
        error.code === 'ETIMEDOUT' ||
        (error.response?.status && error.response.status >= 500);

      this.logger.warn(
        `getMpArticles(${mpId}) page: ${page}, attempt ${4 - retryCount}/3, error: ${error.message}`,
      );

      if (retryCount > 0 && isRetryableError) {
        // 指数退避重试
        const delay = (4 - retryCount) * 2000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.getMpArticles(mpId, page, retryCount - 1);
      }

      throw err;
    }
  }

  async refreshMpArticlesAndUpdateFeed(mpId: string, page = 1) {
    const articles = await this.getMpArticles(mpId, page);

    if (articles.length > 0) {
      let results;
      const { type } =
        this.configService.get<ConfigurationType['database']>('database')!;
      if (type === 'sqlite') {
        // sqlite3 不支持 createMany
        const inserts = articles.map(({ id, picUrl, publishTime, title }) =>
          this.prismaService.article.upsert({
            create: { id, mpId, picUrl, publishTime, title },
            update: {
              publishTime,
              title,
            },
            where: { id },
          }),
        );
        results = await this.prismaService.$transaction(inserts);
      } else {
        results = await (this.prismaService.article as any).createMany({
          data: articles.map(({ id, picUrl, publishTime, title }) => ({
            id,
            mpId,
            picUrl,
            publishTime,
            title,
          })),
          skipDuplicates: true,
        });
      }

      this.logger.debug(
        `refreshMpArticlesAndUpdateFeed create results: ${JSON.stringify(results)}`,
      );
    }

    // 如果文章数量小于 defaultCount，则认为没有更多历史文章
    const hasHistory = articles.length < defaultCount ? 0 : 1;

    await this.prismaService.feed.update({
      where: { id: mpId },
      data: {
        syncTime: Math.floor(Date.now() / 1e3),
        hasHistory,
      },
    });

    return { hasHistory };
  }

  inProgressHistoryMp = {
    id: '',
    page: 1,
  };

  async getHistoryMpArticles(mpId: string) {
    // 检查是否已在运行
    if (this.inProgressHistoryMp.id === mpId) {
      this.logger.log(`getHistoryMpArticles(${mpId}) is already running`);
      return;
    }

    this.inProgressHistoryMp = {
      id: mpId,
      page: 1,
    };

    this.logger.log(`开始获取 ${mpId} 的历史文章`);

    try {
      const feed = await this.prismaService.feed.findFirstOrThrow({
        where: {
          id: mpId,
        },
      });

      // 如果完整同步过历史文章，则直接返回
      if (feed.hasHistory === 0) {
        this.logger.log(`getHistoryMpArticles(${mpId}) has no history`);
        return;
      }

      const total = await this.prismaService.article.count({
        where: {
          mpId,
        },
      });
      this.inProgressHistoryMp.page = Math.ceil(total / defaultCount);
      this.logger.log(
        `getHistoryMpArticles(${mpId}) start from page ${this.inProgressHistoryMp.page}, total articles: ${total}`,
      );

      // 最多尝试一千次
      let i = 1e3;
      while (i-- > 0) {
        // 检查是否被中断
        if (this.inProgressHistoryMp.id !== mpId) {
          this.logger.log(
            `getHistoryMpArticles(${mpId}) was interrupted, breaking`,
          );
          break;
        }

        try {
          const { hasHistory } = await this.refreshMpArticlesAndUpdateFeed(
            mpId,
            this.inProgressHistoryMp.page,
          );
          this.logger.log(
            `getHistoryMpArticles(${mpId}) page ${this.inProgressHistoryMp.page} completed, hasHistory: ${hasHistory}`,
          );

          if (hasHistory < 1) {
            this.logger.log(
              `getHistoryMpArticles(${mpId}) has no more history, breaking`,
            );
            break;
          }
          this.inProgressHistoryMp.page++;
        } catch (err) {
          this.logger.error(
            `getHistoryMpArticles(${mpId}) page ${this.inProgressHistoryMp.page} error`,
            err,
          );
          // 出错时等待更长时间再重试
          await new Promise((resolve) =>
            setTimeout(resolve, this.updateDelayTime * 3 * 1e3),
          );
          continue;
        }

        await new Promise((resolve) =>
          setTimeout(resolve, this.updateDelayTime * 1e3),
        );
      }

      this.logger.log(`getHistoryMpArticles(${mpId}) completed`);
    } catch (err) {
      this.logger.error(`getHistoryMpArticles(${mpId}) error`, err);
      throw err;
    } finally {
      // 确保状态被正确重置
      if (this.inProgressHistoryMp.id === mpId) {
        this.inProgressHistoryMp = {
          id: '',
          page: 1,
        };
        this.logger.log(`getHistoryMpArticles(${mpId}) state reset`);
      }
    }
  }

  isRefreshAllMpArticlesRunning = false;

  async refreshAllMpArticlesAndUpdateFeed() {
    if (this.isRefreshAllMpArticlesRunning) {
      this.logger.log('refreshAllMpArticlesAndUpdateFeed is running');
      return;
    }
    const mps = await this.prismaService.feed.findMany({
      where: { status: 1 },
    });
    this.isRefreshAllMpArticlesRunning = true;

    try {
      this.logger.log(`开始批量更新 ${mps.length} 个订阅源`);
      for (let i = 0; i < mps.length; i++) {
        const { id } = mps[i];
        this.logger.log(`更新进度: ${i + 1}/${mps.length} - ${id}`);

        try {
          await this.refreshMpArticlesAndUpdateFeed(id);
        } catch (err) {
          this.logger.error(`更新订阅源 ${id} 失败`, err);
          // 单个失败不影响整体流程
        }

        // 除了最后一个，其他都等待延迟
        if (i < mps.length - 1) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.updateDelayTime * 1e3),
          );
        }
      }
      this.logger.log('批量更新完成');
    } catch (err) {
      this.logger.error('批量更新异常', err);
      throw err;
    } finally {
      this.isRefreshAllMpArticlesRunning = false;
    }
  }

  async getMpInfo(url: string) {
    url = url.trim();
    const account = await this.getAvailableAccount();

    return this.request
      .post<
        {
          id: string;
          cover: string;
          name: string;
          intro: string;
          updateTime: number;
        }[]
      >(
        `/api/v2/platform/wxs2mp`,
        { url },
        {
          headers: {
            xid: account.id,
            Authorization: `Bearer ${account.token}`,
          },
        },
      )
      .then((res) => res.data);
  }

  async createLoginUrl() {
    return this.request
      .get<{
        uuid: string;
        scanUrl: string;
      }>(`/api/v2/login/platform`)
      .then((res) => res.data);
  }

  async getLoginResult(id: string) {
    return this.request
      .get<{
        message: string;
        vid?: number;
        token?: string;
        username?: string;
      }>(`/api/v2/login/platform/${id}`, { timeout: 120 * 1e3 })
      .then((res) => res.data);
  }
}
