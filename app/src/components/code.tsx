import { useState, type ReactNode } from "react";

/**
 * A code block with light syntax colouring. A small tokenizer of our own - comments, strings,
 * numbers, keywords, types, calls - is enough for the Solidity and TypeScript snippets we show,
 * and keeps the colours in the app's own palette rather than a library's theme.
 */

type Tok = { t: "comment" | "string" | "number" | "keyword" | "type" | "fn" | "plain"; v: string };

const KEYWORDS = new Set([
  "function", "external", "internal", "public", "private", "view", "pure", "returns", "return", "calldata", "memory",
  "contract", "interface", "is", "constant", "immutable", "event", "indexed", "emit", "if", "else", "for", "while",
  "import", "from", "export", "const", "let", "var", "await", "async", "new", "as", "true", "false", "null", "undefined",
  "this", "override", "revert", "require", "modifier", "constructor", "type", "typeof", "in", "of",
]);
const TYPES = /^(u?int(8|16|32|64|128|256)?|bytes(32|4)?|address|bool|string|bytes32|uint8|uint256|Binding|MetadataEntry|Standard|IAdapter8004|IERC8004IdentityRegistry|Ownable|ERC721|ERC1155|ERC6909|AccessControl|Address|Hex)$/;

const RULES: [Tok["t"], RegExp][] = [
  ["comment", /^\/\/[^\n]*|^\/\*[\s\S]*?\*\//],
  ["string", /^"(?:[^"\\\n]|\\.)*"|^'(?:[^'\\\n]|\\.)*'|^`(?:[^`\\]|\\.)*`/],
  ["number", /^0x[0-9a-fA-F]+n?|^\d+(?:\.\d+)?n?/],
  ["plain", /^[A-Za-z_$][\w$]*/],
  ["plain", /^\s+|^./],
];

export function tokenize(code: string): Tok[] {
  const out: Tok[] = [];
  let rest = code;
  while (rest.length) {
    let matched = false;
    for (const [t, re] of RULES) {
      const m = re.exec(rest);
      if (!m) continue;
      let kind: Tok["t"] = t;
      const v = m[0];
      if (t === "plain" && /^[A-Za-z_$]/.test(v)) {
        if (KEYWORDS.has(v)) kind = "keyword";
        else if (TYPES.test(v)) kind = "type";
        else if (/^\s*\(/.test(rest.slice(v.length))) kind = "fn";
      }
      out.push({ t: kind, v });
      rest = rest.slice(v.length);
      matched = true;
      break;
    }
    if (!matched) {
      out.push({ t: "plain", v: rest[0] });
      rest = rest.slice(1);
    }
  }
  return out;
}

export function Highlighted({ code }: { code: string }) {
  const nodes: ReactNode[] = tokenize(code).map((tok, i) => (tok.t === "plain" ? tok.v : <span key={i} className={`tk-${tok.t}`}>{tok.v}</span>));
  return <>{nodes}</>;
}

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 900); }}>
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function CodeBlock({ code, copy = true }: { code: string; copy?: boolean }) {
  return (
    <div className="codeblock">
      {copy && <div className="codeblock-bar"><CopyButton text={code} /></div>}
      <pre><Highlighted code={code} /></pre>
    </div>
  );
}
