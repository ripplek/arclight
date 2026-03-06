export default function Dashboard() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
        Dashboard
      </h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        欢迎使用 ArcLight — 你的智能信息助手
      </p>
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">信源数量</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">今日文章</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
        <div className="rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
          <h3 className="text-sm font-medium text-neutral-500">活跃 Story Arcs</h3>
          <p className="mt-2 text-3xl font-bold">—</p>
        </div>
      </div>
      <div className="mt-8 rounded-lg border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
        <h2 className="text-lg font-semibold">最近摘要</h2>
        <p className="mt-4 text-neutral-500">暂无摘要，等待后续 milestone 实现...</p>
      </div>
    </div>
  );
}
