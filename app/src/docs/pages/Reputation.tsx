import { TypeBadge } from "../../components/ui";
import { Code, H2, Note } from "../Docs";

export function Reputation() {
  return (
    <>
      <h1 className="page-title">Reputation</h1>
      <p className="page-sub">Anyone can make a statement about an agent, by its UBID. Statements are events - on-chain, permanent, and individually revocable by whoever made them.</p>

      <H2 id="types">The five statement types</H2>
      <table className="table">
        <thead><tr><th>Type</th><th>Payload</th><th>How it counts</th><th>Meaning</th></tr></thead>
        <tbody>
          <tr><td><TypeBadge name="STAR" /></td><td className="mono small">one byte: 0 or 1</td><td>latest per attester; counted</td><td className="td-wrap">A cheap thumbs up. Withdrawable - it's a position, not a deletion.</td></tr>
          <tr><td><TypeBadge name="RATING" /></td><td className="mono small">one byte: 0-100</td><td>latest per attester; averaged</td><td className="td-wrap">A quality rating. Replaces your previous one.</td></tr>
          <tr><td><TypeBadge name="REVIEW" /></td><td className="mono small">UTF-8 text</td><td>all live ones accumulate</td><td className="td-wrap">Free text, stored in the event, not a link to a file.</td></tr>
          <tr><td><TypeBadge name="INTERACTION" /></td><td className="mono small">score ‖ reference ‖ text</td><td>all live ones accumulate</td><td className="td-wrap">A record of one dealing: a 0-100 score, the transaction hash, optional text.</td></tr>
          <tr><td><TypeBadge name="CONFIRM_ACCOUNT" /></td><td className="mono small">empty</td><td>latest per attester</td><td className="td-wrap">"I am an additional account of this agent." Counts only while the agent's metadata names the attester.</td></tr>
        </tbody>
      </table>

      <H2 id="one-call">One call, one type</H2>
      <Code lang="solidity">{`attest(uint8 attestationType, bytes32 ubid, bytes32 variant, bytes data)
revoke(bytes32 attestationId)`}</Code>
      <p>
        <span className="mono">variant</span> is caller-interpreted. The protocol uses it only to tell apart
        byte-identical statements made in one block; the explorer uses it to carry the transaction a rating or
        review is about. A rating plus a review is two calls, because they are two types with two aggregation
        rules - a deliberate choice, so neither corrupts the other's arithmetic.
      </p>

      <H2 id="rules">How an indexer reads them</H2>
      <ul className="claim-list">
        <li><b>Identity.</b> A statement's id is a hash of the adapter, the attester, the target, the type, the block, the variant and the data. Byte-identical content in one block is one statement.</li>
        <li><b>State types</b> (star, rating, confirm): the latest live statement per attester is the value. Revoke it and the previous one is live again.</li>
        <li><b>Stream types</b> (review, transaction record): every live statement counts, each revocable on its own.</li>
        <li><b>Revocation</b> changes state only when the revoker is the attester. Anything else is recorded and inert - the explorer's history tab shows those too.</li>
        <li><b>Invalid payloads</b> - a rating above 100, an empty review - are excluded from aggregation at read time, never errors.</li>
        <li><b>Attest before claim</b> is allowed. A statement about a UBID nothing has claimed yet is kept, and acquires meaning if a claim arrives.</li>
      </ul>
      <Note>
        Nothing is stored on-chain for any of this and there is no getter. The rules above are the
        <a href="https://github.com/unruggable-labs/adapter/blob/main/docs/specs/attestation-type-registry-v1.md" target="_blank" rel="noopener noreferrer"> attestation type registry</a>,
        and Adapterscan's indexer is a reference implementation of them.
      </Note>
    </>
  );
}
