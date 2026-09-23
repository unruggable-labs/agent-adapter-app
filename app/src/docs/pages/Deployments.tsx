import { H2, Note } from "../Docs";

const EXPLORERS: Record<string, string> = { sepolia: "https://sepolia.etherscan.io", ethereum: "https://etherscan.io", base: "https://basescan.org" };

/** An address as a link to its chain's block explorer, in full - this page is for copying. */
function A({ chain, address }: { chain: keyof typeof EXPLORERS; address: string }) {
  return <a className="mono small" href={`${EXPLORERS[chain]}/address/${address}`} target="_blank" rel="noopener noreferrer">{address}</a>;
}

export function Deployments() {
  return (
    <>
      <h1 className="page-title">Deployments</h1>

      <H2 id="proxies">Adapter proxies</H2>
      <div className="table-scroll">
        <table className="table">
          <thead><tr><th>Chain</th><th>Chain id</th><th>Adapter proxy</th><th>Implementation</th><th>Adapterscan</th></tr></thead>
          <tbody>
            <tr><td>Sepolia</td><td className="num">11155111</td><td><A chain="sepolia" address="0x7621630cB63a73a194f45A3E6801B8C6A7eC2f92" /></td><td>v0.0.17, since block <a href="https://sepolia.etherscan.io/block/11661779" target="_blank" rel="noopener noreferrer" className="num">11661779</a></td><td><a href="https://testnet.adapterscan.com">testnet.adapterscan.com</a></td></tr>
            <tr><td>Ethereum</td><td className="num">1</td><td><A chain="ethereum" address="0xde152AfB7db5373F34876E1499fbD893A82dD336" /></td><td>pre-v0.0.17</td><td>-</td></tr>
            <tr><td>Base</td><td className="num">8453</td><td><A chain="base" address="0x270d25D2c59A8bcA1B0f40ad95fF7806c0025c27" /></td><td>pre-v0.0.17</td><td>-</td></tr>
          </tbody>
        </table>
      </div>

      <H2 id="registries">ERC-8004 identity registries</H2>
      <table className="table">
        <thead><tr><th>Chain</th><th>IdentityRegistry</th></tr></thead>
        <tbody>
          <tr><td>Sepolia</td><td><A chain="sepolia" address="0x8004A818BFB912233c491871b3d84c89A494BD9e" /></td></tr>
          <tr><td>Ethereum</td><td><A chain="ethereum" address="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" /></td></tr>
          <tr><td>Base</td><td><A chain="base" address="0x8004A169FB4a3325136EB29fA0ceB6D2e539a432" /></td></tr>
        </tbody>
      </table>

      <H2 id="other">Other addresses the adapter reads</H2>
      <table className="table">
        <thead><tr><th>What</th><th>Address</th></tr></thead>
        <tbody>
          <tr><td>delegate.xyz registry (v2, every chain)</td><td><A chain="ethereum" address="0x00000000000000447e69651d841bD8D104Bed493" /></td></tr>
        </tbody>
      </table>
      <p className="hint">Deployment and upgrade records, with verification, live in the contract repository under <span className="mono">deployments/</span>.</p>
    </>
  );
}
