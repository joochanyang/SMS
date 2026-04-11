import { Power } from 'lucide-react';

interface HeaderProps {
  title: string;
  killSwitchActive?: boolean;
  adminName?: string;
}

export default function Header({ title, killSwitchActive = false, adminName }: HeaderProps) {
  return (
    <header className="admin-header">
      <h2 className="admin-header-title">{title}</h2>
      <div className="admin-header-right">
        <div className={`header-kill-badge ${killSwitchActive ? 'active' : 'inactive'}`}>
          <Power size={14} />
          {killSwitchActive ? '긴급 중지 활성' : '정상 운영'}
        </div>
        {adminName && <span className="header-admin-name">{adminName}</span>}
      </div>
    </header>
  );
}
