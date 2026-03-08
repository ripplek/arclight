import { Link, useLocation } from 'react-router';

const settingsNav = [
  { label: 'Topics', path: '/settings/topics', icon: '🏷️' },
  { label: 'Schedule', path: '/settings/schedule', icon: '⏰' },
  { label: 'Push Channels', path: '/settings/push', icon: '📤' },
];

export default function Settings() {
  const location = useLocation();

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <div className="grid gap-4 md:grid-cols-2">
        {settingsNav.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
              location.pathname === item.path
                ? 'bg-neutral-100 dark:bg-neutral-800'
                : 'border-neutral-200 dark:border-neutral-800'
            }`}
          >
            <span className="text-2xl">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
