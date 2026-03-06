import { Outlet, useNavigate, Link, useLocation } from 'react-router';
import { authClient } from '@/lib/auth-client';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: '📊' },
  { label: 'Digests', path: '/digests', icon: '📰' },
  { label: 'Story Arcs', path: '/arcs', icon: '🧵' },
  { label: 'Settings', path: '/settings', icon: '⚙️' },
];

function Sidebar({ className }: { className?: string }) {
  const location = useLocation();

  return (
    <nav className={className}>
      <div className="mb-6 flex items-center gap-2 px-2">
        <span className="text-xl">🔦</span>
        <span className="text-lg font-bold">ArcLight</span>
      </div>
      <ul className="space-y-1">
        {navItems.map((item) => (
          <li key={item.path}>
            <Link
              to={item.path}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
                location.pathname.startsWith(item.path)
                  ? 'bg-neutral-100 font-medium dark:bg-neutral-800'
                  : 'text-neutral-600 dark:text-neutral-400'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function AppLayout() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  const handleLogout = async () => {
    await authClient.signOut();
    navigate('/login');
  };

  // Redirect to login if not authenticated
  if (!isPending && !session) {
    navigate('/login');
    return null;
  }

  return (
    <div className="flex min-h-screen bg-neutral-50 dark:bg-neutral-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 border-r border-neutral-200 p-4 dark:border-neutral-800 lg:block">
        <Sidebar />
      </aside>

      <div className="flex flex-1 flex-col">
        {/* Header */}
        <header className="flex h-14 items-center justify-between border-b border-neutral-200 px-4 dark:border-neutral-800">
          {/* Mobile menu */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden">
                ☰
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-60 p-4">
              <Sidebar />
            </SheetContent>
          </Sheet>

          <div className="flex-1" />

          {/* User menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2">
                <Avatar className="h-7 w-7">
                  <AvatarFallback>
                    {session?.user?.name?.[0]?.toUpperCase() || '?'}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm sm:inline">{session?.user?.name}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate('/settings')}>
                ⚙️ 设置
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleLogout}>
                🚪 退出
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {/* Main content */}
        <main className="flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
