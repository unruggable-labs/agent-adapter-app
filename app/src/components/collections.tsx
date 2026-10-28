import { useState } from "react";
import type { CollectionRow, Identity } from "../lib/api";
import { useApp } from "../lib/app-state";
import { displayName, shortTokenId } from "../lib/chain";
import { ChainTag } from "./chains";
import { markBackground, registrationOf, RegistrationMark } from "./ui";

/** Where a collection's page is. A contract is a collection on one chain, so the chain is in the path. */
export const collectionPath = (c: { chain: string; address: string }) => `/collection/${c.chain}/${c.address}`;

/** A square picture that fills its tile, or the seed's mark where there is none (or it won't load). */
export function TileImage({ image, seed }: { image: string | null | undefined; seed: string }) {
  const [broken, setBroken] = useState(false);
  if (image && !broken) return <img className="tile-img" src={image} alt="" loading="lazy" onError={() => setBroken(true)} />;
  return <span className="tile-img" aria-hidden style={{ background: markBackground(seed) }} />;
}

/** A collection as a tile: its picture, name, chain and how many agents are bound to it. */
export function CollectionTile({ c }: { c: CollectionRow }) {
  const { navigate } = useApp();
  return (
    <a
      className="tile"
      href={collectionPath(c)}
      onClick={(e) => {
        e.preventDefault();
        navigate(collectionPath(c));
      }}
    >
      <TileImage image={c.image} seed={c.address} />
      <span className="tile-body">
        <span className="tile-name" title={c.name}>{c.name}</span>
        <span className="row spread tile-meta">
          <span>{c.identities.toLocaleString()} {c.identities === 1 ? "agent" : "agents"}</span>
          <ChainTag chain={c.chain} bare />
        </span>
      </span>
    </a>
  );
}

/** A token's identity as a tile: the token's picture, the agent's name, how it's registered. */
export function TokenTile({ id }: { id: Identity }) {
  const { navigate } = useApp();
  const href = `/identity/${id.ubid}`;
  return (
    <a
      className="tile"
      href={href}
      onClick={(e) => {
        e.preventDefault();
        navigate(href);
      }}
    >
      <TileImage image={id.image} seed={id.ubid} />
      <span className="tile-body">
        <span className="tile-name" title={displayName(id)}>{displayName(id)}</span>
        <span className="row spread tile-meta">
          {/* The name already carries the token id; this says how the agent exists. */}
          <span>{id.agentIds.length ? `ERC-8004 #${id.agentIds[id.agentIds.length - 1]}` : id.claimed ? "counterfactual" : `token #${shortTokenId(id.tokenId)}`}</span>
          <RegistrationMark r={registrationOf(id)} />
        </span>
      </span>
    </a>
  );
}
