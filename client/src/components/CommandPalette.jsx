import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, LayoutDashboard, FileStack, CalendarCheck, ShieldCheck, Building2, Siren, BarChart3, Bot, Activity, Settings, Plus, ShieldQuestion } from 'lucide-react';
import { apiClient } from '../api/client';

const PAGES = [
  { label: 'Dashboard', to: '/dashboard', icon: LayoutDashboard },
  { label: 'Applications', to: '/applications', icon: FileStack },
  { label: 'Pipeline board', to: '/applications?view=board', icon: FileStack },
  { label: 'Applications past SLA', to: '/applications?overdue=1', icon: FileStack },
  { label: 'EVC Schedule', to: '/evc', icon: CalendarCheck },
  { label: 'Documents', to: '/compliance', icon: ShieldCheck },
  { label: 'Expired documents', to: '/compliance?status=Expired', icon: ShieldCheck },
  { label: 'Undertakings', to: '/compliance?tab=undertakings', icon: ShieldCheck },
  { label: 'Institutions', to: '/institutions', icon: Building2 },
  { label: 'Alert Center', to: '/alerts', icon: Siren },
  { label: 'Import Studio (bulk Excel/CSV)', to: '/import', icon: Building2 },
  { label: 'Reports', to: '/reports', icon: BarChart3 },
  { label: 'AI Assistant', to: '/ai-chat', icon: Bot },
  { label: 'Audit Trail', to: '/activity-logs', icon: Activity },
  { label: 'Verify a letter', to: '/verify', icon: ShieldQuestion },
  { label: 'Settings', to: '/settings', icon: Settings },
];

const ACTIONS = [
  { label: 'New application', to: '/applications?new=1', icon: Plus },
  { label: 'Ask the AI assistant', to: '/ai-chat', icon: Bot },
];

export default function CommandPalette({ onClose }) {
  const [query, setQuery] = useState('');
  const [assets, setAssets] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (query.length >= 2) {
      apiClient.get(`/applications?search=${encodeURIComponent(query)}&limit=6`).then(d => {
        setAssets(Array.isArray(d) ? d : []);
      }).catch(() => setAssets([]));
    } else { setAssets([]); }
  }, [query]);

  const filteredPages = PAGES.filter(p => p.label.toLowerCase().includes(query.toLowerCase()));
  const allItems = [
    ...filteredPages.map(p => ({ ...p, type: 'page' })),
    ...assets.map(a => ({ label: `${a.institution?.name} · ${a.app_number}`, to: `/applications/${a.id}`, icon: FileStack, type: 'asset' })),
    ...(query.length === 0 ? ACTIONS.map(a => ({ ...a, type: 'action' })) : []),
  ];

  const handleSelect = (item) => {
    navigate(item.to);
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(i => Math.min(i + 1, allItems.length - 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(i => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && allItems[selectedIndex]) handleSelect(allItems[selectedIndex]);
  };

  return (
    <div className="sl-command-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sl-command" onKeyDown={handleKeyDown}>
        <div className="sl-command__input-wrapper">
          <Search size={18} className="sl-text-muted" />
          <input ref={inputRef} className="sl-command__input" placeholder="Search applications, institutions, pages…" value={query} onChange={e => { setQuery(e.target.value); setSelectedIndex(0); }} id="command-palette-input" />
          <button className="sl-btn sl-btn--ghost sl-btn--sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="sl-command__results">
          {filteredPages.length > 0 && <div className="sl-command__group-label">Pages</div>}
          {filteredPages.map((item, i) => (
            <div key={item.to} className={`sl-command__item ${selectedIndex === i ? 'active' : ''}`} onClick={() => handleSelect(item)}>
              <div className="sl-command__item-icon"><item.icon size={16} /></div>
              <div className="sl-command__item-text"><div className="sl-command__item-title">{item.label}</div></div>
            </div>
          ))}
          {assets.length > 0 && <div className="sl-command__group-label">Applications</div>}
          {assets.map((a, i) => {
            const idx = filteredPages.length + i;
            return (
              <div key={a.id} className={`sl-command__item ${selectedIndex === idx ? 'active' : ''}`} onClick={() => handleSelect({ to: `/applications/${a.id}` })}>
                <div className="sl-command__item-icon"><FileStack size={16} /></div>
                <div className="sl-command__item-text">
                  <div className="sl-command__item-title">{a.institution?.name}</div>
                  <div className="sl-command__item-desc">{a.app_number} · {a.stage_label}</div>
                </div>
              </div>
            );
          })}
          {query.length === 0 && <div className="sl-command__group-label">Quick Actions</div>}
          {query.length === 0 && ACTIONS.map((item, i) => {
            const idx = filteredPages.length + assets.length + i;
            return (
              <div key={item.label} className={`sl-command__item ${selectedIndex === idx ? 'active' : ''}`} onClick={() => handleSelect(item)}>
                <div className="sl-command__item-icon"><item.icon size={16} /></div>
                <div className="sl-command__item-text"><div className="sl-command__item-title">{item.label}</div></div>
              </div>
            );
          })}
          {allItems.length === 0 && <div className="sl-p-5 sl-text-center sl-text-muted sl-text-sm">No results found</div>}
        </div>
        <div className="sl-command__footer">
          <span><kbd>↑↓</kbd> Navigate <kbd>↵</kbd> Select <kbd>Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
