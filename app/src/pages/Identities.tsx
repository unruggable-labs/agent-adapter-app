import { Addr, ControllerCell, Pager, registrationOf, Skeleton, SkeletonRows, StandardBadge, StatusBadge, Tip, UbidCell } from "../components/ui";
import { api } from "../lib/api";
import { useApp, useLive } from "../lib/app-state";
import { usePageParam } from "../lib/url";

const PAGE_SIZE = 25;

export function IdentitiesPage() {
  const { overview, navigate } = useApp();
  const [page, setPage] = usePageParam(); // ?page=2 in the address bar, so a page can be shared
  // One page at a time, newest first - the server orders and slices; nothing downloads the registry.
  const { data, status } = useLive(() => api.identities({ limit: PAGE_SIZE, offset: page * PAGE_SIZE }), [page]);
  const total = data?.total ?? overview?.identities ?? 0;
  const visible = data?.items ?? [];

  return (
    <div className="page page-wide fade-in">
      <div className="page-head">
        <h1 className="page-title">Identities</h1>
        <div className="head-actions">
          <button className="btn" onClick={() => navigate("/create")}>Create identity</button>
        </div>
      </div>
      <p className="page-sub">
        Register an agent identity. <i>Anything</i> can be registered as an agent identity - it will receive a UBID, a unique hash representing it.
        {overview && overview.dropped > 0 && <span className="t3"> · {overview.dropped} events dropped at verification</span>}
      </p>

      <StatPanels />

      <div className="card card-table table-scroll">
        <table className="table clickable">
          <thead>
            <tr>
              <th><Tip tip="The Universal Binding Identifier - the permanent hash naming this identity. Everything (reputation, wallet links, registration) attaches to this. The mark beside it: a chain link means an ERC-8004 agent is minted, a dashed ring means a counterfactual claim only.">UBID</Tip></th>
              <th><Tip tip="What kind of controller controls the identity: a token standard means whoever owns the token controls it; ACCOUNT means the address itself; CONTRACT_OWNABLE/ADMIN mean the contract's owner or admins.">Standard</Tip></th>
              <th><Tip tip="The thing that controls this identity: its collection (name when known, else the contract address) and token id. For account standards, the address itself.">Controller</Tip></th>
              <th><Tip tip="How the identity exists: 'ERC-8004 #ID' means a real agent was minted on the shared registry with that id; 'counterfactual' means it lives in the event log without a mint. Both share the same UBID and history.">Registration</Tip></th>
              <th className="td-center"><Tip tip="Average of each attester's latest live 0-100 rating.">Rating</Tip></th>
              <th className="td-center">Stars</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((id) => (
              <tr key={id.ubid} onClick={() => navigate(`/identity/${id.ubid}`)}>
                <td><UbidCell ubid={id.ubid} image={id.image} registration={registrationOf(id)} /></td>
                <td><StandardBadge id={id} /></td>
                <td><ControllerCell id={id} /></td>
                <td><StatusBadge id={id} /></td>
                <td className="td-center num">{id.reputation.ratingAverage === null ? <span className="t3">—</span> : id.reputation.ratingAverage.toFixed(0)}</td>
                <td className="td-center num">{id.reputation.stars || <span className="t3">0</span>}</td>
              </tr>
            ))}
            {!data && status === "loading" && <SkeletonRows widths={[0, 50, 60, 60, 30, 30]} />}
            {!data && status === "error" && (
              <tr className="is-static"><td colSpan={6}><div className="empty">Can't reach the indexer - retrying every few seconds.</div></td></tr>
            )}
            {data && data.total === 0 && (
              <tr className="is-static"><td colSpan={6}><div className="empty">No identities yet.</div></td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="row spread" style={{ marginTop: 10 }}>
        {overview ? (
          <p className="hint" style={{ margin: 0 }}>
            <Addr value={overview.adapter} n={42} /> is the adapter every UBID is scoped to on chain <b>{overview.chainId}</b>.
          </p>
        ) : (
          <span />
        )}
        <Pager offset={page * PAGE_SIZE} limit={PAGE_SIZE} total={total} onChange={(o) => setPage(o / PAGE_SIZE)} />
      </div>
    </div>
  );
}

/**
 * The registry at a glance, above the table. A project is a distinct collection or contract that
 * identities are bound to - one collection with a hundred agents is one project. The indexer
 * counts them over the same state the table pages through, so they can't disagree with it.
 */
function StatPanels() {
  const { overview } = useApp();
  const n = (v: number | undefined) => (v === undefined ? <Skeleton w={40} /> : v.toLocaleString());
  return (
    <div className="stat-panels">
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.identities)}</div>
        <div className="stat-panel-l"><Tip tip="Every identity the indexer knows on this network - claimed, registered, or referenced by an attestation.">UBIDs</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.projects)}</div>
        <div className="stat-panel-l"><Tip tip="Distinct collections and contracts that identities are bound to. A collection with a hundred agents counts once.">Projects</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.registered)}</div>
        <div className="stat-panel-l"><Tip tip="Identities with an ERC-8004 agent minted on the shared registry. The rest are counterfactual claims.">Registered on-chain</Tip></div>
      </div>
      <div className="stat-panel">
        <div className="stat-panel-n">{n(overview?.attestations)}</div>
        <div className="stat-panel-l"><Tip tip="Stars, ratings, reviews and transaction records, across every identity.">Attestations</Tip></div>
      </div>
    </div>
  );
}
