import { FC, useMemo } from 'react';
import {
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  getKeyValue,
  Button,
  Spinner,
  Link,
  Tooltip,
} from '@nextui-org/react';
import { trpc } from '@web/utils/trpc';
import dayjs from 'dayjs';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';

const ArticleList: FC = () => {
  const { id } = useParams();

  const mpId = id || '';

  const { data, fetchNextPage, isLoading, hasNextPage } =
    trpc.article.list.useInfiniteQuery(
      {
        limit: 20,
        mpId: mpId,
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
    );

  const { mutateAsync: exportMarkdown, isLoading: isExporting } =
    trpc.article.exportMarkdown.useMutation({});

  const handleExportMarkdown = async (articleId: string, title: string) => {
    try {
      const result = await exportMarkdown(articleId);

      const blob = new Blob([result.markdown], { type: 'text/markdown;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${title.replace(/[^\p{L}\p{N}\s\-_.]/gu, '').slice(0, 50)}.md`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('导出成功', {
        description: `文章 "${title}" 已成功导出为Markdown格式`,
      });
    } catch (error: any) {
      toast.error('导出失败', {
        description: error.message || '导出Markdown时发生错误'
      });
    }
  };

  const items = useMemo(() => {
    const items = data
      ? data.pages.reduce((acc, page) => [...acc, ...page.items], [] as any[])
      : [];

    return items;
  }, [data]);

  return (
    <div>
      <Table
        classNames={{
          base: 'h-full',
          table: 'min-h-[420px]',
        }}
        aria-label="文章列表"
        bottomContent={
          hasNextPage && !isLoading ? (
            <div className="flex w-full justify-center">
              <Button
                isDisabled={isLoading}
                variant="flat"
                onPress={() => {
                  fetchNextPage();
                }}
              >
                {isLoading && <Spinner color="white" size="sm" />}
                加载更多
              </Button>
            </div>
          ) : null
        }
      >
        <TableHeader>
          <TableColumn key="title">标题</TableColumn>
          <TableColumn width={180} key="publishTime">
            发布时间
          </TableColumn>
          <TableColumn width={80} key="actions">
            操作
          </TableColumn>
        </TableHeader>
        <TableBody
          isLoading={isLoading}
          emptyContent={'暂无数据'}
          items={items || []}
          loadingContent={<Spinner />}
        >
          {(item) => (
            <TableRow key={item.id}>
              {(columnKey) => {
                let value = getKeyValue(item, columnKey);

                if (columnKey === 'publishTime') {
                  value = dayjs(value * 1e3).format('YYYY-MM-DD HH:mm:ss');
                  return <TableCell>{value}</TableCell>;
                }

                if (columnKey === 'title') {
                  return (
                    <TableCell>
                      <Link
                        className="visited:text-neutral-400"
                        isBlock
                        showAnchorIcon
                        color="foreground"
                        target="_blank"
                        href={`https://mp.weixin.qq.com/s/${item.id}`}
                      >
                        {value}
                      </Link>
                    </TableCell>
                  );
                }

                if (columnKey === 'actions') {
                  return (
                    <TableCell>
                      <Tooltip content="导出为Markdown">
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          color="primary"
                          isLoading={isExporting}
                          onPress={() => handleExportMarkdown(item.id, item.title)}
                        >
                          MD
                        </Button>
                      </Tooltip>
                    </TableCell>
                  );
                }

                return <TableCell>{value}</TableCell>;
              }}
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
};

export default ArticleList;
