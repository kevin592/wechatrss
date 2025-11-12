import { INestApplication, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { z } from 'zod';
import { TrpcService } from '@server/trpc/trpc.service';
import * as trpcExpress from '@trpc/server/adapters/express';
import { TRPCError } from '@trpc/server';
import { PrismaService } from '@server/prisma/prisma.service';
import { statusMap } from '@server/constants';
import { ConfigService } from '@nestjs/config';
import { ConfigurationType } from '@server/configuration';
import { FeedsService } from '@server/feeds/feeds.service';
import { load } from 'cheerio';

@Injectable()
export class TrpcRouter {
  private feedsService: FeedsService;

  constructor(
    private readonly trpcService: TrpcService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly moduleRef: ModuleRef,
  ) {}

  onModuleInit() {
    this.feedsService = this.moduleRef.get(FeedsService, { strict: false });
  }

  private readonly logger = new Logger(this.constructor.name);

  accountRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;

        const items = await this.prismaService.account.findMany({
          take: limit + 1,
          where: {},
          select: {
            id: true,
            name: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            token: false,
          },
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        const disabledAccounts = this.trpcService.getBlockedAccountIds();
        return {
          blocks: disabledAccounts,
          items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const account = await this.prismaService.account.findUnique({
          where: { id },
        });
        if (!account) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No account with id '${id}'`,
          });
        }
        return account;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string().min(1).max(32),
          token: z.string().min(1),
          name: z.string().min(1),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const account = await this.prismaService.account.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });
        this.trpcService.removeBlockedAccount(id);

        return account;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            token: z.string().min(1).optional(),
            name: z.string().min(1).optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const account = await this.prismaService.account.update({
          where: { id },
          data,
        });
        this.trpcService.removeBlockedAccount(id);
        return account;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.account.delete({ where: { id } });
        this.trpcService.removeBlockedAccount(id);

        return id;
      }),
  });

  feedRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor } = input;

        const items = await this.prismaService.feed.findMany({
          take: limit + 1,
          where: {},
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
          orderBy: {
            createdAt: 'asc',
          },
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        return {
          items: items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const feed = await this.prismaService.feed.findUnique({
          where: { id },
        });
        if (!feed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No feed with id '${id}'`,
          });
        }
        return feed;
      }),
    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpName: z.string(),
          mpCover: z.string(),
          mpIntro: z.string(),
          syncTime: z
            .number()
            .optional()
            .default(Math.floor(Date.now() / 1e3)),
          updateTime: z.number(),
          status: z.number().default(statusMap.ENABLE),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const feed = await this.prismaService.feed.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return feed;
      }),
    edit: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          data: z.object({
            mpName: z.string().optional(),
            mpCover: z.string().optional(),
            mpIntro: z.string().optional(),
            syncTime: z.number().optional(),
            updateTime: z.number().optional(),
            status: z.number().optional(),
          }),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, data } = input;
        const feed = await this.prismaService.feed.update({
          where: { id },
          data,
        });
        return feed;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.feed.delete({ where: { id } });
        return id;
      }),

    refreshArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        if (mpId) {
          await this.trpcService.refreshMpArticlesAndUpdateFeed(mpId);
        } else {
          await this.trpcService.refreshAllMpArticlesAndUpdateFeed();
        }
      }),

    isRefreshAllMpArticlesRunning: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.isRefreshAllMpArticlesRunning;
      },
    ),
    getHistoryArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string().optional(),
        }),
      )
      .mutation(async ({ input: { mpId = '' } }) => {
        this.trpcService.getHistoryMpArticles(mpId);
      }),
    getInProgressHistoryMp: this.trpcService.protectedProcedure.query(
      async () => {
        return this.trpcService.inProgressHistoryMp;
      },
    ),
  });

  articleRouter = this.trpcService.router({
    list: this.trpcService.protectedProcedure
      .input(
        z.object({
          limit: z.number().min(1).max(1000).nullish(),
          cursor: z.string().nullish(),
          mpId: z.string().nullish(),
        }),
      )
      .query(async ({ input }) => {
        const limit = input.limit ?? 1000;
        const { cursor, mpId } = input;

        const items = await this.prismaService.article.findMany({
          orderBy: [
            {
              publishTime: 'desc',
            },
          ],
          take: limit + 1,
          where: mpId ? { mpId } : undefined,
          cursor: cursor
            ? {
                id: cursor,
              }
            : undefined,
        });
        let nextCursor: typeof cursor | undefined = undefined;
        if (items.length > limit) {
          // Remove the last item and use it as next cursor

          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          const nextItem = items.pop()!;
          nextCursor = nextItem.id;
        }

        return {
          items,
          nextCursor,
        };
      }),
    byId: this.trpcService.protectedProcedure
      .input(z.string())
      .query(async ({ input: id }) => {
        const article = await this.prismaService.article.findUnique({
          where: { id },
        });
        if (!article) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No article with id '${id}'`,
          });
        }
        return article;
      }),

    add: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
          mpId: z.string(),
          title: z.string(),
          picUrl: z.string().optional().default(''),
          publishTime: z.number(),
        }),
      )
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        const article = await this.prismaService.article.upsert({
          where: {
            id,
          },
          update: data,
          create: input,
        });

        return article;
      }),
    delete: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: id }) => {
        await this.prismaService.article.delete({ where: { id } });
        return id;
      }),
    exportMarkdown: this.trpcService.protectedProcedure
      .input(z.string())
      .mutation(async ({ input: articleId }) => {
        const article = await this.prismaService.article.findUnique({
          where: { id: articleId },
        });

        if (!article) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No article with id '${articleId}'`,
          });
        }

        const feed = await this.prismaService.feed.findUnique({
          where: { id: article.mpId },
        });

        if (!feed) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `No feed found for article '${articleId}'`,
          });
        }

        try {
          // 使用FeedsService.tryGetContent方法，与RSS保持一致的内容获取机制
          const content = await this.feedsService.tryGetContent(articleId);

          const markdown = this.generateMarkdown(article, feed, content);

          return {
            markdown,
            title: article.title,
            author: feed.mpName,
          };
        } catch (error: any) {
          this.logger.error(`Failed to export article ${articleId}: ${error.message}`);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: '导出文章失败，请重试',
          });
        }
      }),
  });

  platformRouter = this.trpcService.router({
    getMpArticles: this.trpcService.protectedProcedure
      .input(
        z.object({
          mpId: z.string(),
        }),
      )
      .mutation(async ({ input: { mpId } }) => {
        try {
          const results = await this.trpcService.getMpArticles(mpId);
          return results;
        } catch (err: any) {
          this.logger.log('getMpArticles err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
            cause: err.stack,
          });
        }
      }),
    getMpInfo: this.trpcService.protectedProcedure
      .input(
        z.object({
          wxsLink: z
            .string()
            .refine((v) => v.startsWith('https://mp.weixin.qq.com/s/')),
        }),
      )
      .mutation(async ({ input: { wxsLink: url } }) => {
        try {
          const results = await this.trpcService.getMpInfo(url);
          return results;
        } catch (err: any) {
          this.logger.log('getMpInfo err: ', err);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: err.response?.data?.message || err.message,
            cause: err.stack,
          });
        }
      }),

    createLoginUrl: this.trpcService.protectedProcedure.mutation(async () => {
      return this.trpcService.createLoginUrl();
    }),
    getLoginResult: this.trpcService.protectedProcedure
      .input(
        z.object({
          id: z.string(),
        }),
      )
      .query(async ({ input }) => {
        return this.trpcService.getLoginResult(input.id);
      }),
  });

  appRouter = this.trpcService.router({
    feed: this.feedRouter,
    account: this.accountRouter,
    article: this.articleRouter,
    platform: this.platformRouter,
  });

  private convertHtmlToMarkdown(html: string): string {
    if (!html || html === '获取全文失败，请重试~') {
      return html || '';
    }

    const $ = load(html);
    let markdown = '';

    // 移除不需要的元素
    $('script, style, meta, link, noscript, iframe').remove();

    // 找到主要内容区域
    const contentArea = $('#js_content, .rich_media_content, section[style*="font-size"]').first();
    if (contentArea.length === 0) {
      return '内容获取失败，无法找到文章正文区域';
    }

    // 处理内容区域
    markdown = processContent(contentArea);

    // 后处理：智能标题识别和格式优化
    markdown = postProcessMarkdown(markdown);

    // 处理内容的主函数
    function processContent(element: any): string {
      let result = '';

      // 处理每个子元素
      element.children().each(function() {
        const child = $(this);
        const tagName = this.tagName?.toLowerCase() || '';

        // 跳过空元素
        if (child.text().trim() === '' && !child.is('img, br, hr')) {
          return;
        }

        switch (tagName) {
          case 'p':
          case 'section':
            const paragraph = processParagraph(child);
            if (paragraph) {
              result += paragraph + '\n\n';
            }
            break;

          case 'h1':
          case 'h2':
          case 'h3':
          case 'h4':
          case 'h5':
          case 'h6':
            result += processHeading(child) + '\n\n';
            break;

          case 'ul':
          case 'ol':
            result += processList(child) + '\n';
            break;

          case 'blockquote':
            result += processBlockquote(child) + '\n\n';
            break;

          case 'pre':
          case 'code':
            result += processCode(child) + '\n\n';
            break;

          case 'img':
            result += processImage(child) + '\n\n';
            break;

          case 'hr':
            result += '---\n\n';
            break;

          case 'div':
            // 处理可能包含标题的div
            if (child.children().length > 0) {
              result += processContent(child);
            } else {
              const text = child.text().trim();
              if (text) {
                result += text + '\n\n';
              }
            }
            break;

          case 'span':
            // 处理span元素，通常包含格式化文本
            const spanContent = processInlineContent(child);
            if (spanContent) {
              result += spanContent + '\n\n';
            }
            break;

          case 'strong':
          case 'b':
          case 'em':
          case 'i':
            // 内联格式化元素，作为段落处理
            const formattedText = processInlineContent(child);
            if (formattedText) {
              result += formattedText + '\n\n';
            }
            break;

          default:
            // 处理其他元素
            if (child.children().length > 0) {
              result += processContent(child);
            } else {
              const text = child.text().trim();
              if (text) {
                result += text + '\n\n';
              }
            }
        }
      });

      return result;
    }

    function processHeading(element: any): string {
      const text = element.text().trim();
      const level = parseInt(element[0].tagName?.charAt(1) || '3');
      const prefix = '#'.repeat(level);
      return `${prefix} ${text}`;
    }

    function processParagraph(element: any): string {
      let text = element.text().trim();

      // 预处理文本，修复格式问题
      text = preprocessText(text);

      // 智能检测标题模式
      if (isTitlePattern(text)) {
        return `### ${text}`;
      }

      return processInlineContent(element);
    }

    function preprocessText(text: string): string {
      // 清理多余的星号，但保留重要的加粗
      text = text.replace(/\*{4,}/g, '**');

      // 修复数字格式：01  02 03 -> 01. 02. 03.
      text = text.replace(/^(\d{1,2})\s{2,}/gm, '$1. ');

      return text;
    }

    function isTitlePattern(text: string): boolean {
      // 检测数字标题模式：01、02、03等
      const numberTitlePattern = /^(\d{1,2})[.\s、]/;

      // 检测加粗的数字模式：****01 等
      const boldNumberPattern = /^\*+\d+[.\s、]/;

      // 检测星号包围的内容（可能是标题）
      const starTitlePattern = /^\*{2,}[^*]+\*{2,}$/;

      // 检测特定关键词模式
      const keywordPatterns = [
        /^(总结|结语|延伸阅读|推荐阅读)/,
        /^(作者|编辑|运营|主编)/,
        /^(来源|分享|预约)/,
        /^(点击链接|扫码|感兴趣)/,
        /^(写在最后|推荐|关注)/
      ];

      return numberTitlePattern.test(text) ||
             boldNumberPattern.test(text) ||
             starTitlePattern.test(text) ||
             keywordPatterns.some(pattern => pattern.test(text));
    }

    function processInlineContent(element: any): string {
      let result = '';

      element.contents().each(function() {
        const child = $(this);

        if (this.type === 'text') {
          result += child.text();
        } else {
          const tagName = this.tagName?.toLowerCase() || '';

          switch (tagName) {
            case 'strong':
            case 'b':
              result += `**${child.text()}**`;
              break;
            case 'em':
            case 'i':
              result += `*${child.text()}*`;
              break;
            case 'code':
              result += `\`${child.text()}\``;
              break;
            case 'a':
              const href = child.attr('href') || '';
              const text = child.text();
              result += href ? `[${text}](${href})` : text;
              break;
            case 'span':
              // 检查span是否有特殊样式
              const style = child.attr('style') || '';
              if (style.includes('font-weight') && style.includes('bold')) {
                result += `**${child.text()}**`;
              } else {
                result += child.text();
              }
              break;
            case 'br':
              result += '\n';
              break;
            default:
              if (child.children().length > 0) {
                result += processInlineContent(child);
              } else {
                result += child.text();
              }
          }
        }
      });

      return result.trim();
    }

    function processList(element: any): string {
      let result = '';
      const isOrdered = element[0].tagName?.toLowerCase() === 'ol';

      element.children('li').each(function(index) {
        const item = $(this);
        const content = processInlineContent(item);

        if (isOrdered) {
          result += `${index + 1}. ${content}\n`;
        } else {
          result += `- ${content}\n`;
        }
      });

      return result;
    }

    function processBlockquote(element: any): string {
      const content = processInlineContent(element);
      const lines = content.split('\n');
      return lines.map(line => `> ${line}`).join('\n');
    }

    function processCode(element: any): string {
      const text = element.text().trim();
      const isCodeBlock = element[0].tagName?.toLowerCase() === 'pre';

      if (isCodeBlock) {
        return `\`\`\`\n${text}\n\`\`\``;
      } else {
        return `\`${text}\``;
      }
    }

    function processImage(element: any): string {
      const src = element.attr('data-src') || element.attr('src') || '';
      const alt = element.attr('alt') || '';
      return src ? `![${alt}](${src})` : '';
    }

    // 后处理函数
    function postProcessMarkdown(text: string): string {
      let cleaned = text;

      // 清理广告和推广内容
      const adPatterns = [
        /扫码领取.*?优惠券/g,
        /感兴趣，就可以直接领券加入星球/g,
        /自带 72 小时退款功能/g,
        /点击链接了解详情/g,
        /已突破\d+名成员/g,
        /未来十年最重要的事情/g,
        /良心定价.*?元\/年/g,
        /目前优惠价.*?元\/年/g,
        /仅限前\d+个名额/g,
        /额外赠送.*?价值\d+元/g,
        /双十一.*?福利/g,
        /【2025送给自己最好的礼物/g,
        /深度绑定粥左罗/g,
        /3650天，觉醒、蜕变/g,
        /END看完记得关注/g,
        /及时收看更多好文/g,
        /推荐阅读：.*$/,
        /超过\d+人已加入/g,
        /平均每月增加\d+.*?名新会员/g,
        /欢迎扫码了解/g,
        /公众号再一起做10年.*?第\d+期.*/g,
        /现在加入顶峰会可免费加入.*$/g
      ];

      adPatterns.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
      });

      // 清理多余的特殊字符和格式
      cleaned = cleaned
        // 修复数字标题格式
        .replace(/^(\s*\d{1,2})\s{2,}/gm, '$1. ')
        // 清理多余的星号
        .replace(/\*{4,}/g, '**')
        // 移除孤立的符号
        .replace(/^\s*[▲▲]\s*/gm, '')
        .replace(/\s*[▲▲]\s*$/gm, '')
        // 修复加粗数字标题
        .replace(/^\*+\s*(\d+[.\s、])/gm, '**$1')
        // 修复连在一起的数字
        .replace(/(\d)([。！？])\s*(\d+)/g, '$1$2\n\n### $3')
        .replace(/(\d[.\s、])([^\n])/g, (match, p1, p2) => {
          // 检查p2是否是标题内容
          const titleIndicators = ['不要', '别人', '真心', '一定', '人生', '成年', '生活', '时间', '关系', '圈子', '边界', '能量'];
          const shouldBreak = titleIndicators.some(indicator => p2.startsWith(indicator));
          return shouldBreak ? `${p1}\n\n### ${p2}` : match;
        });

      // 改进段落分隔和结构
      cleaned = cleaned
        // 确保标题前有适当的空行
        .replace(/([^\n])\s*(###\s*\d+)/g, '\n\n$2')
        .replace(/([。！？])\s*(###)/g, '$1\n\n$2')
        .replace(/([。！？])\s*\n(\d{1,2}[.\s、])/g, '$1\n\n### $2')
        // 确保数字标题后有适当的空行
        .replace(/(###\s*\d+[.\s、][^\n])\s*([^\n###])/g, (match, p1, p2) => {
          // 检查p2是否是另一个标题或段落的开始
          const nextIsTitle = /^\s*###|\d+[.\s、]/.test(p2);
          const nextIsImportant = /^[\u4e00-\u9fa5]/.test(p2.trim());

          if (nextIsTitle) {
            return `${p1}\n\n${p2}`;
          } else if (nextIsImportant && !p2.startsWith('，') && !p2.startsWith('。')) {
            return `${p1}\n\n${p2}`;
          }
          return `${p1}\n${p2}`;
        })
        // 优化换行和空格
        .replace(/\n{4,}/g, '\n\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\n+|\n+$/g, '')
        .replace(/\s+$/gm, '')
        // 修复中文标点后的空格问题
        .replace(/([，。！？；：])\s+([a-zA-Z0-9])/g, '$1$2')
        .replace(/([a-zA-Z])\s+([，。！？；：])/g, '$1$2')
        .trim();

      return cleaned;
    }

    // 最终清理
    markdown = markdown
      .replace(/\n{4,}/g, '\n\n\n') // 最多保留3个换行
      .replace(/\n{3,}/g, '\n\n')   // 最多保留2个换行
      .replace(/^\n+|\n+$/g, '')    // 移除开头和结尾的空行
      .replace(/\s+$/gm, '')        // 移除每行末尾的空白
      .trim();

    return markdown;
  }

  private generateMarkdown(article: any, feed: any, content: string): string {
    const publishDate = new Date(article.publishTime * 1000).toLocaleString('zh-CN');

    let markdown = `# ${article.title}\n\n`;
    markdown += `**作者**: ${feed.mpName}\n\n`;
    markdown += `**发布时间**: ${publishDate}\n\n`;

    if (article.picUrl) {
      markdown += `**封面图片**: [![封面](${article.picUrl})](${article.picUrl})\n\n`;
    }

    markdown += `**原文链接**: https://mp.weixin.qq.com/s/${article.id}\n\n`;
    markdown += `---\n\n`;

    markdown += `## 正文\n\n`;

    // 使用HTML到Markdown转换函数
    const markdownContent = this.convertHtmlToMarkdown(content);
    markdown += markdownContent;

    return markdown;
  }

  async applyMiddleware(app: INestApplication) {
    app.use(
      `/trpc`,
      trpcExpress.createExpressMiddleware({
        router: this.appRouter,
        createContext: ({ req }) => {
          const authCode =
            this.configService.get<ConfigurationType['auth']>('auth')!.code;

          if (authCode && req.headers.authorization !== authCode) {
            return {
              errorMsg: 'authCode不正确！',
            };
          }
          return {
            errorMsg: null,
          };
        },
        middleware: (req, res, next) => {
          next();
        },
      }),
    );
  }
}

export type AppRouter = TrpcRouter[`appRouter`];
