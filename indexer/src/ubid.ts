import { encodeAbiParameters, keccak256, type Address, type Hex } from "viem";

/** IERC8217.Standard enum values. Append-only; the uint8 sits in every UBID preimage. */
export enum Standard {
  ERC721 = 0,
  ERC1155 = 1,
  ERC6909 = 2,
  ERC1155F = 3,
  ERC6909F = 4,
  ACCOUNT = 5,
  CONTRACT_OWNABLE = 6,
  CONTRACT_ADMIN = 7,
}

export const STANDARD_NAMES: Record<number, string> = {
  0: "ERC721",
  1: "ERC1155",
  2: "ERC6909",
  3: "ERC1155F",
  4: "ERC6909F",
  5: "ACCOUNT",
  6: "CONTRACT_OWNABLE",
  7: "CONTRACT_ADMIN",
};

/** The five token standards get the ownerless-collection window; the three account standards don't. */
export const SINGLE_OWNER_TOKEN_STANDARDS = new Set([Standard.ERC721, Standard.ERC1155F, Standard.ERC6909F]);
export const ACCOUNT_STANDARDS = new Set([Standard.ACCOUNT, Standard.CONTRACT_OWNABLE, Standard.CONTRACT_ADMIN]);

function toBeBytes(value: bigint): Uint8Array {
  if (value === 0n) return new Uint8Array([0]); // shortest non-empty big-endian
  const bytes: number[] = [];
  let v = value;
  while (v > 0n) {
    bytes.unshift(Number(v & 0xffn));
    v >>= 8n;
  }
  return new Uint8Array(bytes);
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): Hex {
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

/**
 * ERC-7930 v1 Interoperable Address for an EVM account:
 * Version(0x0001) || ChainType(0x0000, CAIP-350 eip155) || RefLen(1) || Ref (shortest
 * non-empty big-endian chain id) || AddrLen(0x14) || 20 address bytes.
 */
export function interoperableAddress(chainId: bigint, account: Address): Hex {
  const ref = toBeBytes(chainId);
  const addr = account.slice(2).toLowerCase();
  const addrBytes = new Uint8Array(addr.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return bytesToHex(
    concatBytes(new Uint8Array([0x00, 0x01, 0x00, 0x00, ref.length]), ref, new Uint8Array([0x14]), addrBytes),
  );
}

/** Chain-only ERC-7930 identifier (AddrLen = 0). */
export function chainIdentifier(chainId: bigint): Hex {
  const ref = toBeBytes(chainId);
  return bytesToHex(concatBytes(new Uint8Array([0x00, 0x01, 0x00, 0x00, ref.length]), ref, new Uint8Array([0x00])));
}

/**
 * The Universal Binding Identifier:
 * keccak256(abi.encode(adapterInteroperableAddress, standard, boundAddress, tokenId))
 * with the standard as the enum's uint8. Chain- and adapter-scoped by the ERC-7930 bytes.
 */
export function computeUbid(
  chainId: bigint,
  adapter: Address,
  standard: Standard,
  boundAddress: Address,
  tokenId: bigint,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "bytes" }, { type: "uint8" }, { type: "address" }, { type: "uint256" }],
      [interoperableAddress(chainId, adapter), standard, boundAddress, tokenId],
    ),
  );
}

/** AttestationType enum. Append-only; the uint8 sits in every attestationId preimage. */
export enum AttestationType {
  UNSPECIFIED = 0,
  CONFIRM_ACCOUNT = 1,
  STAR = 2,
  RATING = 3,
  REVIEW = 4,
  INTERACTION = 5,
}

export const ATTESTATION_TYPE_NAMES: Record<number, string> = {
  0: "UNSPECIFIED",
  1: "CONFIRM_ACCOUNT",
  2: "STAR",
  3: "RATING",
  4: "REVIEW",
  5: "INTERACTION",
};

/**
 * attestationId = keccak256(abi.encode(adapterInteroperableAddress, attester, ubid,
 * attestationType, block.number, variant, data))
 */
export function computeAttestationId(
  chainId: bigint,
  adapter: Address,
  attester: Address,
  ubid: Hex,
  attestationType: AttestationType,
  blockNumber: bigint,
  variant: Hex,
  data: Hex,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "bytes" },
        { type: "address" },
        { type: "bytes32" },
        { type: "uint8" },
        { type: "uint256" },
        { type: "bytes32" },
        { type: "bytes" },
      ],
      [interoperableAddress(chainId, adapter), attester, ubid, attestationType, blockNumber, variant, data],
    ),
  );
}
