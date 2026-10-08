import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  Clock3,
  Coins,
  Copy,
  Flame,
  Link2,
  LockKeyhole,
  LogOut,
  Menu,
  Plus,
  Pencil,
  Search,
  Sparkles,
  Trophy,
  UserRoundPlus,
  X,
} from 'lucide-react';

type User = { id: number; username: string; balance: number };
type Leader = User & { wins: number };
type Invite = { code: string; createdAt: string; expiresAt: string; redeemedCount: number };
type NotificationPreferences = { newPolls: boolean; participatedResolutions: boolean };
type NotificationSettings = {
  pushEnabled: boolean;
  publicKey: string | null;
  hasSubscription: boolean;
  preferences: NotificationPreferences;
};
type OptionStat = { count: number; staked: number; odds: number };
type Bet = { choiceIndex: number; amount: number; odds: number };
type Market = {
  id: string;
  title: string;
  description: string;
  category: string;
  options: string[];
  outcomeIndex: number | null;
  status: 'open' | 'resolved';
  cancelledAt: string | null;
  endsAt: string;
  createdAt: string;
  creator: string;
  creatorId: number;
  optionStats: OptionStat[];
  totalStaked: number;
  bettorsCount: number;
  myBet: Bet | null;
};

type MarketListFilter = 'all' | 'open' | 'awaiting' | 'settled' | 'positions';
type AuthMode = 'register' | 'login';

const categories = ['All', 'Culture', 'Sports', 'Technology', 'Politics', 'Community', 'Science'];
const marketFilters: { id: MarketListFilter; label: string }[] = [
  { id: 'all', label: 'All markets' },
  { id: 'open', label: 'Open' },
  { id: 'awaiting', label: 'Awaiting result' },
  { id: 'settled', label: 'Settled' },
  { id: 'positions', label: 'My positions' },
];

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Something went wrong.');
  return data as T;
}

function formatCredits(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatDeadline(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function timeRemaining(value: string, now: number) {
  const difference = new Date(value).getTime() - now;
  if (difference <= 0) return 'Market ended';
  const hours = Math.floor(difference / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h ${Math.floor((difference % 3_600_000) / 60_000)}m left`;
  return `${Math.max(1, Math.floor(difference / 60_000))}m left`;
}

function localDateTime(value: Date) {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [leaders, setLeaders] = useState<Leader[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [networkError, setNetworkError] = useState('');
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingMarket, setEditingMarket] = useState<Market | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeFilter, setActiveFilter] = useState<MarketListFilter>('all');
  const [sortBy, setSortBy] = useState<'newest' | 'popular'>('newest');
  const [search, setSearch] = useState('');
  const [now, setNow] = useState(Date.now());
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  async function refresh() {
    try {
      const me = await request<{ user: User | null }>('/api/me');
      setUser(me.user);
      if (!me.user) {
        setMarkets([]);
        setLeaders([]);
        setInvites([]);
        setNetworkError('');
        if (new URLSearchParams(window.location.search).has('invite')) setAuthMode('register');
        return;
      }
      const [marketData, leaderboard, inviteData] = await Promise.all([
        request<{ markets: Market[] }>('/api/markets'),
        request<{ leaders: Leader[] }>('/api/leaderboard'),
        request<{ invites: Invite[] }>('/api/invites'),
      ]);
      setMarkets(marketData.markets);
      setLeaders(leaderboard.leaders);
      setInvites(inviteData.invites);
      setNetworkError('');
    } catch {
      setNetworkError('The market board could not connect. Try refreshing in a moment.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const visibleMarkets = markets
    .filter((market) => activeCategory === 'All' || market.category === activeCategory)
    .filter((market) => {
      const expired = new Date(market.endsAt).getTime() <= now;
      if (activeFilter === 'open') return market.status === 'open' && !expired;
      if (activeFilter === 'awaiting') return market.status === 'open' && expired;
      if (activeFilter === 'settled') return market.status === 'resolved';
      if (activeFilter === 'positions') return Boolean(market.myBet);
      return true;
    })
    .filter((market) => `${market.title} ${market.description} ${market.category} ${market.creator}`
      .toLowerCase().includes(search.trim().toLowerCase()))
    .sort((first, second) => sortBy === 'popular'
      ? second.bettorsCount - first.bettorsCount || second.totalStaked - first.totalStaked
      : new Date(second.createdAt).getTime() - new Date(first.createdAt).getTime());

  const openCount = markets.filter((market) => market.status === 'open' && new Date(market.endsAt).getTime() > now).length;
  const awaitingCount = markets.filter((market) => market.status === 'open' && new Date(market.endsAt).getTime() <= now).length;
  const totalPool = markets.reduce((sum, market) => sum + (market.status === 'open' ? market.totalStaked : 0), 0);

  async function handleAuth(mode: AuthMode, values: Record<string, string>) {
    const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register'
      ? values
      : { identity: values.identity, password: values.password };
    const result = await request<{ user: User }>(path, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (mode === 'register' && new URLSearchParams(window.location.search).has('invite')) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    setUser(result.user);
    setAuthMode(null);
    await refresh();
  }

  async function signOut() {
    await request('/api/auth/logout', { method: 'POST' });
    setUser(null);
    await refresh();
  }

  async function createInvite(validForDays: number) {
    const result = await request<{ invite: Invite }>('/api/invites', {
      method: 'POST',
      body: JSON.stringify({ validForDays }),
    });
    setInvites((current) => [result.invite, ...current]);
    return result.invite;
  }

  async function placeBet(marketId: string, choiceIndex: number, amount: number) {
    if (!user) {
      setAuthMode('login');
      throw new Error('Sign in to place your pick.');
    }
    const result = await request<{ user: User }>(`/api/markets/${marketId}/bets`, {
      method: 'POST',
      body: JSON.stringify({ choiceIndex, amount }),
    });
    setUser(result.user);
    await refresh();
  }

  async function resolveMarket(marketId: string, outcomeIndex: number) {
    if (!user) {
      setAuthMode('login');
      throw new Error('Sign in to resolve this market.');
    }
    const result = await request<{ user: User }>(`/api/markets/${marketId}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ outcomeIndex }),
    });
    setUser(result.user);
    await refresh();
  }

  async function createMarket(values: {
    title: string;
    description: string;
    category: string;
    options: string[];
    endsAt: string;
  }) {
    await request('/api/markets', { method: 'POST', body: JSON.stringify(values) });
    setCreateOpen(false);
    setActiveFilter('all');
    setActiveCategory('All');
    await refresh();
  }

  async function editMarket(marketId: string, values: {
    title: string;
    description: string;
    category: string;
    endsAt: string;
  }) {
    await request(`/api/markets/${marketId}`, {
      method: 'PATCH',
      body: JSON.stringify(values),
    });
    setEditingMarket(null);
    await refresh();
  }

  async function cancelMarket(marketId: string) {
    const result = await request<{ user: User }>(`/api/markets/${marketId}/cancel`, { method: 'POST' });
    setUser(result.user);
    await refresh();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="NiggaBet home">
          <span className="wordmark-icon"><Activity size={19} strokeWidth={2.4} /></span>
          <span>niggaBet<span className="wordmark-period">.</span></span>
        </a>
        <div className="topbar-center"><span className="live-indicator" /> COMMUNITY BOARD</div>
        <div className="topbar-actions">
          {user ? (
            <>
              <div className="balance-pill"><Coins size={16} /><span>{formatCredits(user.balance)}</span><small>CR</small></div>
              <button className="button invite-button" title="Create an invite link" aria-label="Create an invite link" onClick={() => setInviteOpen(true)}><UserRoundPlus size={15} /><span>Invite</span></button>
              <button className="button notification-button" title="Notification settings" aria-label="Notification settings" onClick={() => setNotificationsOpen(true)}><Bell size={16} /><span>Alerts</span></button>
              <div className="user-menu">
                <span className="avatar">{user.username.slice(0, 1).toUpperCase()}</span>
                <span className="user-name">{user.username}</span>
                <button className="icon-button signout-button" title="Sign out" onClick={() => void signOut()}><LogOut size={16} /></button>
              </div>
            </>
          ) : (
            <>
              <button className="text-button signin-button" onClick={() => setAuthMode('login')}>Sign in</button>
              <button className="button button-dark header-join" onClick={() => setAuthMode('register')}>Join with invite <ArrowRight size={15} /></button>
            </>
          )}
          {user && <button className="icon-button mobile-menu-button" aria-label="Toggle menu" onClick={() => setMobileNavOpen(!mobileNavOpen)}>
            {mobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>}
        </div>
      </header>

      <div className={`workspace${mobileNavOpen ? ' nav-open' : ''}${user ? '' : ' workspace-guest'}`} id="top">
        <aside className="sidebar">
          <div className="sidebar-topline">YOUR ROOM</div>
          <button className={`side-link${activeFilter === 'all' ? ' side-link-active' : ''}`} onClick={() => setActiveFilter('all')}>
            <Activity size={17} /><span>Market board</span><span className="side-count">{markets.length}</span>
          </button>
          <button className={`side-link${activeFilter === 'open' ? ' side-link-active' : ''}`} onClick={() => setActiveFilter('open')}>
            <Flame size={17} /><span>Live markets</span><span className="side-count">{openCount}</span>
          </button>
          <button className={`side-link${activeFilter === 'awaiting' ? ' side-link-active' : ''}`} onClick={() => setActiveFilter('awaiting')}>
            <Clock3 size={17} /><span>Awaiting result</span><span className="side-count">{awaitingCount}</span>
          </button>
          <button className={`side-link${activeFilter === 'positions' ? ' side-link-active' : ''}`} onClick={() => {
            if (!user) setAuthMode('login');
            else setActiveFilter('positions');
          }}>
            <Coins size={17} /><span>My positions</span>
          </button>

          <div className="sidebar-divider" />
          <div className="sidebar-topline">TOPICS</div>
          <div className="topic-list">
            {categories.slice(1).map((category, index) => (
              <button
                className={`topic-link${activeCategory === category ? ' topic-link-active' : ''}`}
                key={category}
                onClick={() => setActiveCategory(activeCategory === category ? 'All' : category)}
              >
                <span className={`topic-dot topic-dot-${index}`} />{category}
              </button>
            ))}
          </div>

          <div className="sidebar-bottom">
            <div className="credits-card">
              <div className="credits-card-icon"><Sparkles size={16} /></div>
              <div className="credits-card-copy">
                <strong>{user ? `${formatCredits(user.balance)} credits` : 'Play for keeps'}</strong>
                <span>Virtual points. Real bragging rights.</span>
              </div>
              {!user && <button className="credits-card-action" onClick={() => setAuthMode('register')} aria-label="Join NiggaBet"><ArrowRight size={16} /></button>}
            </div>
            <div className="sidebar-footnote">NO CASH. JUST CONVICTION.</div>
          </div>
        </aside>

        <main className="main-content">
          <section className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-rule" /> THE CROWD HAS A CALL</div>
              <h1>{user ? <>Make your <span>prediction.</span></> : <>Good calls start <span>with an invite.</span></>}</h1>
              <p className="welcome-copy">{user ? 'A little conviction goes a long way.' : 'NiggaBet is a private room for predictions and virtual credits.'}</p>
            </div>
            <button className="button button-accent create-button" onClick={() => {
              if (!user) setAuthMode('register');
              else setCreateOpen(true);
            }}>
              {user ? <><Plus size={17} strokeWidth={2.5} /> Create a market</> : <><LockKeyhole size={15} /> Enter with an invite</>}
            </button>
          </section>

          {networkError && <div className="network-alert" role="status">{networkError}<button onClick={() => void refresh()}>Retry</button></div>}

          {user ? <>
          <section className="stats-row" aria-label="Market statistics">
            <div className="stat-cell"><span className="stat-label">OPEN MARKETS</span><strong>{openCount.toString().padStart(2, '0')}</strong><span className="stat-caption"><span className="stat-green-dot" /> taking predictions</span></div>
            <div className="stat-cell"><span className="stat-label">TOTAL IN PLAY</span><strong>{formatCredits(totalPool)} <small>CR</small></strong><span className="stat-caption">across the room</span></div>
            <div className="stat-cell"><span className="stat-label">WAITING ON A CALL</span><strong>{awaitingCount.toString().padStart(2, '0')}</strong><span className="stat-caption">ready for a result</span></div>
            <div className="stat-stamp"><span>YOUR</span><strong>CALL</strong><span>COUNTS.</span><ArrowDownRight size={21} /></div>
          </section>

          <section className="board-section">
            <div className="section-heading">
              <div>
                <div className="eyebrow section-eyebrow">THE BOARD</div>
                <h2>Markets <span className="heading-count">{visibleMarkets.length}</span></h2>
              </div>
              <label className="search-box">
                <Search size={16} />
                <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a market" aria-label="Search markets" />
                {search && <button className="search-clear" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
              </label>
            </div>

            <div className="market-toolbar">
              <div className="market-tabs" role="tablist" aria-label="Filter markets">
                {marketFilters.map((filter) => (
                  <button
                    role="tab"
                    aria-selected={activeFilter === filter.id}
                    className={`market-tab${activeFilter === filter.id ? ' market-tab-active' : ''}`}
                    key={filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                  >{filter.label}</button>
                ))}
              </div>
              <label className="sort-select-wrap"><span>SORT</span>
                <select aria-label="Sort markets" value={sortBy} onChange={(event) => setSortBy(event.target.value as 'newest' | 'popular')}>
                  <option value="newest">Newest</option><option value="popular">Most active</option>
                </select><ChevronDown size={14} />
              </label>
            </div>

            <div className="market-list" aria-live="polite">
              {loading ? (
                <div className="loading-state"><span className="loading-spinner" />Gathering the room...</div>
              ) : visibleMarkets.length ? visibleMarkets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  user={user}
                  now={now}
                  onBet={placeBet}
                  onResolve={resolveMarket}
                  onEdit={setEditingMarket}
                  onCancel={cancelMarket}
                  onSignIn={() => setAuthMode('login')}
                />
              )) : (
                <div className="empty-state">
                  <div className="empty-state-mark"><Activity size={22} /></div>
                  <h3>{search || activeCategory !== 'All' || activeFilter !== 'all' ? 'Nothing on this part of the board.' : 'A clear board. Your move.'}</h3>
                  <p>{search || activeCategory !== 'All' || activeFilter !== 'all'
                    ? 'Try another topic or filter.'
                    : 'Start a market and see where the room lands.'}</p>
                  {activeFilter === 'all' && activeCategory === 'All' && !search && (
                    <button className="button button-dark empty-create" onClick={() => {
                      if (!user) setAuthMode('register');
                      else setCreateOpen(true);
                    }}><Plus size={16} /> Start the first market</button>
                  )}
                </div>
              )}
            </div>
            <div className="board-foot"><span>ALL CREDITS ARE VIRTUAL</span><span>·</span><span>ONE PICK PER MARKET</span><span>·</span><span>ODDS LOCK WHEN YOU PICK</span></div>
          </section>
          </> : (
            <section className="members-only">
              <div className="members-only-content">
                <div className="eyebrow"><span className="eyebrow-rule" /> MEMBERS ONLY</div>
                <h2>The board is behind <em>the door.</em></h2>
                <p>Markets and member picks stay private. Sign in, or use a one-time invite code from someone in the room.</p>
                <div className="members-only-actions">
                  <button className="button button-dark" onClick={() => setAuthMode('login')}>Sign in <ArrowRight size={15} /></button>
                  <button className="button members-outline-button" onClick={() => setAuthMode('register')}>Enter invite code</button>
                </div>
              </div>
              <div className="members-only-aside">
                <div><span>01</span><strong>One invitation</strong><small>One new account</small></div>
                <div><span>02</span><strong>1,000 credits</strong><small>Virtual, from day one</small></div>
                <div><span>03</span><strong>Your call</strong><small>Make the room count</small></div>
              </div>
            </section>
          )}
        </main>

        <aside className="right-rail">
          <section className="rail-section room-card">
            <div className="rail-label"><span className="rail-label-dot" /> IN THE ROOM</div>
            <h3>A better call, <em>together.</em></h3>
            <div className="room-numbers">
              <div><strong>{leaders.length}</strong><span>members</span></div>
              <div><strong>{markets.length}</strong><span>markets made</span></div>
            </div>
            <div className="room-note"><span className="room-note-mark">i</span> Every new member starts with 1,000 virtual credits.</div>
          </section>

          <section className="rail-section leaderboard-section">
            <div className="rail-heading"><div><div className="rail-label">THE SCOREBOARD</div><h3>Top callers</h3></div><Trophy size={18} /></div>
            {leaders.length ? (
              <ol className="leader-list">
                {leaders.slice(0, 5).map((leader, index) => (
                  <li className="leader-row" key={leader.id}>
                    <span className={`leader-rank${index === 0 ? ' leader-rank-first' : ''}`}>{String(index + 1).padStart(2, '0')}</span>
                    <span className="leader-avatar">{leader.username.slice(0, 1).toUpperCase()}</span>
                    <span className="leader-name">{leader.username}</span>
                    <span className="leader-balance">{formatCredits(leader.balance)}<small> CR</small></span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="leader-empty"><span><Trophy size={16} /></span><p>First call is still up for grabs.</p></div>
            )}
            <div className="leaderboard-foot">RANKED BY VIRTUAL BALANCE <ArrowRight size={13} /></div>
          </section>

          <section className="rail-section room-rules">
            <div className="rules-icon"><Sparkles size={16} /></div>
            <div><strong>Odds follow the room.</strong><p>More picks on an outcome shorten its odds. Your quoted odds lock when you place a pick.</p></div>
          </section>

          <div className="rail-footer"><span>ODDSROOM / 001</span><span>BUILT FOR THE BOLD</span></div>
        </aside>
      </div>

      {authMode && <AuthModal mode={authMode} initialInviteCode={new URLSearchParams(window.location.search).get('invite') ?? ''} onModeChange={setAuthMode} onClose={() => setAuthMode(null)} onSubmit={handleAuth} />}
      {createOpen && <CreateMarketModal onClose={() => setCreateOpen(false)} onSubmit={createMarket} />}
      {editingMarket && <EditMarketModal market={editingMarket} onClose={() => setEditingMarket(null)} onSubmit={editMarket} />}
      {inviteOpen && user && <InviteModal invites={invites} onCreate={createInvite} onClose={() => setInviteOpen(false)} />}
      {notificationsOpen && user && <NotificationSettingsModal onClose={() => setNotificationsOpen(false)} />}
    </div>
  );
}

function MarketCard({
  market,
  user,
  now,
  onBet,
  onResolve,
  onEdit,
  onCancel,
  onSignIn,
}: {
  market: Market;
  user: User | null;
  now: number;
  onBet: (marketId: string, choiceIndex: number, amount: number) => Promise<void>;
  onResolve: (marketId: string, outcomeIndex: number) => Promise<void>;
  onEdit: (market: Market) => void;
  onCancel: (marketId: string) => Promise<void>;
  onSignIn: () => void;
}) {
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [stake, setStake] = useState('50');
  const [resolveChoice, setResolveChoice] = useState('');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState('');
  const cancelledAt = market.cancelledAt;
  const expired = new Date(market.endsAt).getTime() <= now;
  const cancelled = cancelledAt !== null;
  const resolved = market.status === 'resolved' && !cancelled;
  const canBet = !expired && market.status === 'open' && !market.myBet && Boolean(user);
  const stakeNumber = Number(stake);
  const optionTotal = market.optionStats.reduce((sum, option) => sum + option.count, 0);

  async function submitBet(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      onSignIn();
      return;
    }
    if (selectedChoice === null) {
      setError('Pick an outcome first.');
      return;
    }
    if (!Number.isSafeInteger(stakeNumber) || stakeNumber < 1 || stakeNumber > user.balance) {
      setError('Choose a whole-number stake within your credit balance.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onBet(market.id, selectedChoice, stakeNumber);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not place that pick.');
    } finally {
      setBusy(false);
    }
  }

  async function submitResolution(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user) {
      onSignIn();
      return;
    }
    if (resolveChoice === '') {
      setError('Choose the outcome that happened.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onResolve(market.id, Number(resolveChoice));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not resolve this market.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelPoll() {
    if (!window.confirm('Cancel this poll and refund every caller’s original stake? The poll and its pick history will remain visible as cancelled.')) return;
    setCancelling(true);
    setError('');
    try {
      await onCancel(market.id);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not cancel this poll.');
    } finally {
      setCancelling(false);
    }
  }

  return (
    <article className="market-card">
      <div className="market-card-top">
        <div className="market-category"><span className={`category-square category-${market.category.toLowerCase()}`} />{market.category}</div>
        <div className={`market-status${cancelled || resolved ? ' status-settled' : expired ? ' status-awaiting' : ' status-live'}`}>
          <span />{cancelled ? 'Cancelled' : resolved ? 'Settled' : expired ? 'Awaiting result' : 'Open'}
        </div>
      </div>
      <h3 className="market-title">{market.title}</h3>
      {market.description && <p className="market-description">{market.description}</p>}
      <div className="market-meta"><span>By <strong>{market.creator}</strong></span><span className="meta-separator">·</span><span><Clock3 size={13} />{cancelledAt ? `Cancelled ${formatDeadline(cancelledAt)}` : resolved ? `Ended ${formatDeadline(market.endsAt)}` : timeRemaining(market.endsAt, now)}</span></div>
      {market.status === 'open' && user?.id === market.creatorId && (
        <div className="market-owner-actions">
          <button className="market-edit-button" onClick={() => onEdit(market)}><Pencil size={13} /> Edit poll</button>
          <button className="market-cancel-button" onClick={() => void cancelPoll()} disabled={cancelling}><X size={13} />{cancelling ? 'Refunding...' : 'Cancel & refund'}</button>
        </div>
      )}

      <div className={`outcome-grid${market.options.length > 2 ? ' outcome-grid-many' : ''}`}>
        {market.options.map((option, index) => {
          const stat = market.optionStats[index];
          const percentage = optionTotal ? Math.round((stat.count / optionTotal) * 100) : 0;
          const isWinner = resolved && market.outcomeIndex === index;
          return (
            <button
              className={`outcome-button${selectedChoice === index ? ' outcome-selected' : ''}${isWinner ? ' outcome-winner' : ''}${resolved && !isWinner ? ' outcome-lost' : ''}`}
              key={`${market.id}-${option}`}
              onClick={() => {
                if (canBet) setSelectedChoice(index);
                else if (!user && !expired && !resolved) setSelectedChoice(index);
              }}
              disabled={market.status === 'resolved' || expired || Boolean(market.myBet)}
              aria-pressed={selectedChoice === index}
            >
              <span className="outcome-label"><span>{option}{isWinner && <Check size={14} />}</span><span className="outcome-odds">{stat.odds.toFixed(2)}×</span></span>
              <span className="outcome-stat"><span className="outcome-bar"><span style={{ width: `${percentage}%` }} /></span><span>{percentage}%</span></span>
              <span className="outcome-bets">{stat.count} {stat.count === 1 ? 'pick' : 'picks'} <span>·</span> {formatCredits(stat.staked)} CR</span>
            </button>
          );
        })}
      </div>

      {market.myBet && (
        <div className={`position-note${cancelled ? ' position-refunded' : resolved ? market.myBet.choiceIndex === market.outcomeIndex ? ' position-won' : ' position-lost' : ''}`}>
          <span>{cancelled ? 'STAKE REFUNDED' : resolved ? market.myBet.choiceIndex === market.outcomeIndex ? 'PICK HIT' : 'PICK MISSED' : 'YOUR POSITION'}</span>
          <strong>{market.options[market.myBet.choiceIndex]} · {formatCredits(market.myBet.amount)} CR at {market.myBet.odds.toFixed(2)}×</strong>
          {cancelled && <span className="position-return">{formatCredits(market.myBet.amount)} CR returned</span>}
          {resolved && market.myBet.choiceIndex === market.outcomeIndex && <span className="position-return">+{formatCredits(Math.floor(market.myBet.amount * market.myBet.odds))} CR returned</span>}
        </div>
      )}

      {canBet && (
        <form className="bet-form" onSubmit={(event) => void submitBet(event)}>
          <div className="stake-control">
            <label htmlFor={`stake-${market.id}`}>STAKE</label>
            <div className="stake-input-wrap"><input id={`stake-${market.id}`} type="number" min="1" max={user?.balance ?? 100000} step="1" value={stake} onChange={(event) => setStake(event.target.value)} /><span>CR</span></div>
            <div className="stake-presets">
              {[25, 100].map((value) => <button key={value} type="button" onClick={() => setStake(String(value))} disabled={Boolean(user && user.balance < value)}>+{value}</button>)}
              <button type="button" onClick={() => user && setStake(String(user.balance))} disabled={!user}>MAX</button>
            </div>
          </div>
          <div className="bet-submit-wrap">
            <span className="potential-return">{selectedChoice !== null && stakeNumber > 0
              ? `POTENTIAL RETURN  ${formatCredits(Math.floor(stakeNumber * market.optionStats[selectedChoice].odds))} CR · ${market.optionStats[selectedChoice].odds.toFixed(2)}×`
              : 'PICK AN OUTCOME'}</span>
            <button className="button button-dark bet-submit" type="submit" disabled={busy || (Boolean(user) && selectedChoice === null)}>
              {busy ? 'Placing...' : user ? 'Place your pick' : 'Sign in to pick'} <ArrowRight size={15} />
            </button>
          </div>
        </form>
      )}

      {market.status === 'open' && (
        <form className="resolve-form" onSubmit={(event) => void submitResolution(event)}>
          <div className="resolve-copy"><strong>{expired ? 'Time to call it.' : 'End this poll early?'}</strong><span>{expired ? 'Which outcome happened?' : 'Anyone signed in can resolve this poll now.'}</span></div>
          <label className="resolve-select-wrap">
            <select aria-label="Choose the outcome that happened" value={resolveChoice} onChange={(event) => setResolveChoice(event.target.value)}>
              <option value="">Select result</option>
              {market.options.map((option, index) => <option value={index} key={option}>{option}</option>)}
            </select><ChevronDown size={14} />
          </label>
          <button type="submit" className="button button-dark resolve-submit" disabled={busy}>{busy ? 'Saving...' : 'Resolve'} <Check size={14} /></button>
        </form>
      )}

      {error && <div className="form-error inline-error" role="alert">{error}</div>}

      <div className="market-card-footer"><span><Coins size={14} /> {formatCredits(market.totalStaked)} CR {cancelled ? 'refunded' : 'in play'}</span><span>{market.bettorsCount} {market.bettorsCount === 1 ? 'caller' : 'callers'}</span>{resolved && <span className="resolved-outcome">Result: {market.options[market.outcomeIndex ?? 0]}</span>}</div>
    </article>
  );
}

function AuthModal({
  mode,
  initialInviteCode,
  onModeChange,
  onClose,
  onSubmit,
}: {
  mode: AuthMode;
  initialInviteCode: string;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onSubmit: (mode: AuthMode, values: Record<string, string>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const register = mode === 'register';

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>;
    setBusy(true);
    setError('');
    try {
      await onSubmit(mode, values);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not sign you in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="dialog-mark"><Activity size={19} /></div>
        <div className="eyebrow dialog-eyebrow">A SEAT AT THE TABLE</div>
        <h2 id="auth-title">{register ? 'Join the room.' : 'Good to have you back.'}</h2>
        <p className="dialog-intro">{register ? 'Use a one-time invite. Your first 1,000 credits are on us.' : 'Sign in to get back to your calls.'}</p>
        <div className="auth-switch" role="tablist">
          <button className={!register ? 'auth-tab-active' : ''} onClick={() => { onModeChange('login'); setError(''); }}>Sign in</button>
          <button className={register ? 'auth-tab-active' : ''} onClick={() => { onModeChange('register'); setError(''); }}>Create account</button>
        </div>
        <form className="dialog-form" onSubmit={(event) => void handleSubmit(event)}>
          {register ? (
            <>
              <label>USERNAME<input autoComplete="username" name="username" placeholder="Pick a name" minLength={3} maxLength={20} required /></label>
              <label>EMAIL<input autoComplete="email" name="email" type="email" placeholder="you@example.com" required /></label>
              <label>INVITE CODE<input autoComplete="off" name="inviteCode" placeholder="One-time code" defaultValue={initialInviteCode} required /></label>
            </>
          ) : (
            <label>USERNAME OR EMAIL<input autoComplete="username" name="identity" placeholder="Your sign-in" required /></label>
          )}
          <label>PASSWORD<input autoComplete={register ? 'new-password' : 'current-password'} name="password" type="password" minLength={register ? 8 : undefined} placeholder={register ? 'At least 8 characters' : 'Your password'} required /></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-dark dialog-submit" type="submit" disabled={busy}>{busy ? 'One moment...' : register ? 'Create your account' : 'Sign in'} <ArrowRight size={16} /></button>
        </form>
        <div className="dialog-trust"><span><Check size={13} /> Virtual credits only</span><span><Check size={13} /> No cash deposits</span></div>
      </section>
    </div>
  );
}

function InviteModal({
  invites,
  onCreate,
  onClose,
}: {
  invites: Invite[];
  onCreate: (validForDays: number) => Promise<Invite>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copiedCode, setCopiedCode] = useState('');
  const [validForDays, setValidForDays] = useState('7');

  async function copyLink(code: string) {
    const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopiedCode(code);
      setError('');
    } catch {
      setError('Clipboard access is unavailable. Select the link above to copy it.');
    }
  }

  async function generateInvite() {
    setBusy(true);
    setError('');
    try {
      const invite = await onCreate(Number(validForDays));
      setCopiedCode('');
      await copyLink(invite.code);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create an invite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog invite-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="dialog-mark"><UserRoundPlus size={19} /></div>
        <div className="eyebrow dialog-eyebrow">GROW THE ROOM</div>
        <h2 id="invite-title">Bring someone in.</h2>
        <p className="dialog-intro">Invite links can be reused until they expire.</p>
        <label className="invite-duration">VALID FOR
          <select value={validForDays} onChange={(event) => setValidForDays(event.target.value)}>
            <option value="1">1 day</option>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <button className="button button-accent generate-invite" onClick={() => void generateInvite()} disabled={busy}>
          <Plus size={16} />{busy ? 'Making invite...' : 'Create an invite link'}
        </button>
        {error && <div className="form-error invite-error" role="alert">{error}</div>}
        <div className="invite-list-heading">YOUR INVITES <span>{invites.length}</span></div>
        {invites.length ? (
          <div className="invite-list">
            {invites.map((invite) => {
              const expired = new Date(invite.expiresAt).getTime() <= Date.now();
              const inviteUrl = `${window.location.origin}/?invite=${encodeURIComponent(invite.code)}`;
              return (
                <div className="invite-row" key={invite.code}>
                  <div className="invite-row-top"><span className="invite-code"><Link2 size={13} />{invite.code}</span><span className={expired ? 'invite-used' : 'invite-ready'}>{expired ? 'EXPIRED' : `${invite.redeemedCount} SIGNUPS`}</span></div>
                  <div className="invite-expiry">Expires {formatDeadline(invite.expiresAt)}</div>
                  <div className="invite-link-row"><input aria-label={`Invite link ${invite.code}`} readOnly value={inviteUrl} onFocus={(event) => event.currentTarget.select()} /><button className="icon-button" title="Copy invite link" aria-label={`Copy invite ${invite.code}`} disabled={expired} onClick={() => void copyLink(invite.code)}>{copiedCode === invite.code ? <Check size={16} /> : <Copy size={15} />}</button></div>
                  {copiedCode === invite.code && <div className="invite-copied">Link copied</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="invite-empty">No invites yet. Create a reusable link for new members.</div>
        )}
      </section>
    </div>
  );
}

function urlBase64ToUint8Array(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

function NotificationSettingsModal({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const result = await request<NotificationSettings>('/api/notifications/settings');
        const registration = 'serviceWorker' in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined;
        const existingSubscription = registration ? await registration.pushManager.getSubscription() : null;
        if (active) {
          setSettings(result);
          setSubscription(existingSubscription);
        }
      } catch (requestError) {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Could not load notification settings.');
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function enablePush() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!settings?.pushEnabled || !settings.publicKey) {
        throw new Error('Browser push is not configured on this server yet.');
      }
      if (!window.isSecureContext) {
        throw new Error('Browser push requires HTTPS (except on localhost).');
      }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        throw new Error('This browser does not support push notifications.');
      }
      const permission = Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable push.');

      const registration = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const nextSubscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(settings.publicKey),
        });
      await request('/api/notifications/subscriptions', {
        method: 'POST',
        body: JSON.stringify(nextSubscription.toJSON()),
      });
      setSubscription(nextSubscription);
      setSettings((current) => current ? { ...current, hasSubscription: true } : current);
      setMessage('Push is enabled on this browser. Choose which updates you want below.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not enable browser push.');
    } finally {
      setBusy(false);
    }
  }

  async function updatePreferences(key: keyof NotificationPreferences, value: boolean) {
    if (!settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    const preferences = { ...settings.preferences, [key]: value };
    try {
      await request('/api/notifications/preferences', {
        method: 'PUT',
        body: JSON.stringify(preferences),
      });
      setSettings({ ...settings, preferences });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not save notification preferences.');
    } finally {
      setBusy(false);
    }
  }

  async function disableThisBrowser() {
    if (!subscription || !settings) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await request<{ hasSubscription: boolean }>('/api/notifications/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
      setSubscription(null);
      setSettings({ ...settings, hasSubscription: result.hasSubscription });
      setMessage('Push has been disabled on this browser.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not disable push on this browser.');
    } finally {
      setBusy(false);
    }
  }

  const unsupported = !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window);
  const secureContext = window.isSecureContext;
  const permissionDenied = 'Notification' in window && Notification.permission === 'denied';

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog notification-dialog" role="dialog" aria-modal="true" aria-labelledby="notification-title">
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="dialog-mark"><Bell size={18} /></div>
        <div className="eyebrow dialog-eyebrow">YOUR ALERTS</div>
        <h2 id="notification-title">Stay in the loop.</h2>
        <p className="dialog-intro">Choose which moments should send a browser notification.</p>
        {loading ? <div className="invite-empty">Loading notification settings...</div> : (
          <>
            {!settings?.pushEnabled && <div className="notification-note">Push is not configured on this server. The administrator needs to add VAPID settings.</div>}
            {settings?.pushEnabled && (!secureContext || unsupported) && <div className="notification-note">Push requires a supported browser and HTTPS. Localhost is allowed for development.</div>}
            {permissionDenied && <div className="notification-note">Notifications are blocked by this browser. Allow them in the site settings, then try again.</div>}
            {settings?.pushEnabled && secureContext && !unsupported && (
              <div className="notification-device-row">
                <span>{subscription ? 'This browser is connected' : settings.hasSubscription ? 'Another browser is connected' : 'No browser is connected'}</span>
                {subscription
                  ? <button className="market-cancel-button" onClick={() => void disableThisBrowser()} disabled={busy}>Disable this browser</button>
                  : <button className="button button-dark notification-enable" onClick={() => void enablePush()} disabled={busy}>{busy ? 'Connecting...' : 'Enable browser push'}</button>}
              </div>
            )}
            <label className="notification-option">
              <input
                type="checkbox"
                checked={settings?.preferences.newPolls ?? false}
                disabled={busy || !subscription || !settings?.pushEnabled}
                onChange={(event) => void updatePreferences('newPolls', event.target.checked)}
              />
              <span><strong>New polls</strong><small>When someone creates a poll.</small></span>
            </label>
            <label className="notification-option">
              <input
                type="checkbox"
                checked={settings?.preferences.participatedResolutions ?? false}
                disabled={busy || !subscription || !settings?.pushEnabled}
                onChange={(event) => void updatePreferences('participatedResolutions', event.target.checked)}
              />
              <span><strong>Polls I joined are resolved</strong><small>When a poll you picked in is settled.</small></span>
            </label>
          </>
        )}
        {error && <div className="form-error notification-message" role="alert">{error}</div>}
        {message && <div className="notification-success" role="status">{message}</div>}
      </section>
    </div>
  );
}

function EditMarketModal({
  market,
  onClose,
  onSubmit,
}: {
  market: Market;
  onClose: () => void;
  onSubmit: (marketId: string, values: { title: string; description: string; category: string; endsAt: string }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const minimumEnd = localDateTime(new Date(Date.now() + 60_000));

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const category = String(form.get('category') ?? '');
    const endsAt = String(form.get('endsAt') ?? '');
    if (title.length < 8) {
      setError('Make the question at least 8 characters long.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(market.id, { title, description, category, endsAt: new Date(endsAt).toISOString() });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not edit this poll.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="dialog-mark"><Pencil size={17} /></div>
        <div className="eyebrow dialog-eyebrow">UPDATE YOUR POLL</div>
        <h2 id="edit-title">Edit the details.</h2>
        <p className="dialog-intro">Answer choices stay fixed so existing picks keep their meaning.</p>
        <form className="dialog-form create-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>YOUR QUESTION<input name="title" defaultValue={market.title} minLength={8} maxLength={100} required /></label>
          <label>CONTEXT <span className="optional-label">OPTIONAL</span><textarea name="description" defaultValue={market.description} rows={2} maxLength={280} /></label>
          <div className="form-two-col">
            <label>TOPIC<select name="category" defaultValue={market.category}><option>Community</option><option>Culture</option><option>Sports</option><option>Technology</option><option>Politics</option><option>Science</option></select><ChevronDown size={14} /></label>
            <label>MARKET CLOSES<input name="endsAt" type="datetime-local" min={minimumEnd} defaultValue={localDateTime(new Date(market.endsAt))} required /></label>
          </div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button className="button button-dark dialog-submit" type="submit" disabled={busy}>
            {busy ? 'Saving...' : 'Save poll'} <Check size={15} />
          </button>
        </form>
      </section>
    </div>
  );
}

function CreateMarketModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (values: { title: string; description: string; category: string; options: string[]; endsAt: string }) => Promise<void>;
}) {
  const [format, setFormat] = useState<'binary' | 'multiple'>('binary');
  const [options, setOptions] = useState(['', '']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const minimumEnd = localDateTime(new Date(Date.now() + 60 * 60 * 1000));
  const initialEnd = localDateTime(new Date(Date.now() + 48 * 60 * 60 * 1000));

  function updateOption(index: number, value: string) {
    setOptions((current) => current.map((option, optionIndex) => optionIndex === index ? value : option));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const title = String(form.get('title') ?? '').trim();
    const description = String(form.get('description') ?? '').trim();
    const category = String(form.get('category') ?? 'Community');
    const submittedOptions = format === 'binary' ? ['Yes', 'No'] : options.map((option) => option.trim());
    const endsAt = String(form.get('endsAt') ?? '');
    if (title.length < 8) {
      setError('Make the question at least 8 characters long.');
      return;
    }
    if (format === 'multiple' && (submittedOptions.length < 2 || submittedOptions.some((option) => !option))) {
      setError('Fill in each answer choice.');
      return;
    }
    if (new Set(submittedOptions.map((option) => option.toLowerCase())).size !== submittedOptions.length) {
      setError('Each answer choice needs to be different.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ title, description, category, options: submittedOptions, endsAt: new Date(endsAt).toISOString() });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not create your market.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="dialog create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <button className="dialog-close icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        <div className="dialog-mark dialog-mark-accent"><Plus size={19} /></div>
        <div className="eyebrow dialog-eyebrow">PUT IT TO THE ROOM</div>
        <h2 id="create-title">Set the question.</h2>
        <p className="dialog-intro">Make it clear. Give the room a deadline.</p>
        <form className="dialog-form create-form" onSubmit={(event) => void handleSubmit(event)}>
          <label>YOUR QUESTION<input name="title" placeholder="What do you think will happen?" minLength={8} maxLength={100} required /></label>
          <label>CONTEXT <span className="optional-label">OPTIONAL</span><textarea name="description" rows={2} maxLength={280} placeholder="Add a little more detail for the room." /></label>
          <div className="form-two-col">
            <label>TOPIC<select name="category" defaultValue="Community"><option>Community</option><option>Culture</option><option>Sports</option><option>Technology</option><option>Politics</option><option>Science</option></select><ChevronDown size={14} /></label>
            <label>MARKET CLOSES<input name="endsAt" type="datetime-local" min={minimumEnd} defaultValue={initialEnd} required /></label>
          </div>
          <div className="format-label">ANSWER FORMAT</div>
          <div className="format-switch" role="radiogroup" aria-label="Answer format">
            <button type="button" role="radio" aria-checked={format === 'binary'} className={format === 'binary' ? 'format-active' : ''} onClick={() => setFormat('binary')}><span className="format-glyph">Y/N</span> Yes or no</button>
            <button type="button" role="radio" aria-checked={format === 'multiple'} className={format === 'multiple' ? 'format-active' : ''} onClick={() => setFormat('multiple')}><span className="format-glyph">A·B</span> Multiple choice</button>
          </div>
          {format === 'multiple' && (
            <div className="choice-editor">
              {options.map((option, index) => (
                <div className="choice-input-row" key={index}><span>{String.fromCharCode(65 + index)}</span><input aria-label={`Answer choice ${index + 1}`} value={option} maxLength={40} placeholder={`Choice ${index + 1}`} onChange={(event) => updateOption(index, event.target.value)} />{options.length > 2 && <button type="button" aria-label={`Remove choice ${index + 1}`} onClick={() => setOptions((current) => current.filter((_, currentIndex) => currentIndex !== index))}><X size={15} /></button>}</div>
              ))}
              {options.length < 6 && <button className="add-choice" type="button" onClick={() => setOptions((current) => [...current, ''])}><Plus size={14} /> Add a choice</button>}
            </div>
          )}
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="create-dialog-footer"><span><Sparkles size={14} /> Odds follow pick counts and lock at placement.</span><button className="button button-accent dialog-submit" type="submit" disabled={busy}>{busy ? 'Opening...' : 'Open this market'} <ArrowRight size={16} /></button></div>
        </form>
      </section>
    </div>
  );
}