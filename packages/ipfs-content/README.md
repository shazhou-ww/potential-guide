# @potential-guide/ipfs-content

**Private regression fixtures only; not published or installed by production consumers.**
Production CAR code lives in `pguide-task-bundle/car`; Gateway/UnixFS reads live in
`task-engine`. Existing legacy adapter tests remain here to preserve migration
vectors. Active Task fixtures use checked artifact bytes and explicit memory import, without RPC or pin.
The historical API description below applies only to these test fixtures.

Thin local policy adapters for official Helia/IPLD, not a second IPFS implementation
or Task Bundle interpreter. There is one support package, with independent codec,
read, write and pin operations. No operation starts a node or enables discovery.
Use `/read` for Gateway/content access, `/codec` for offline file-tree/CAR
conversion, and `/publish` for Kubo write/pin. The root entry point aggregates
these APIs for compatibility; Engine/service imports use `/read` so author
codecs and the RPC factory are not loaded by read-only startup.

## Offline codec

`encodeContentCar(files)` uses `@helia/unixfs` and `@helia/car` with a
`blockstore-core` memory store; it returns `{cid, bytes}` (CARv1).
Import settings are fixed explicitly, **not Helia's defaults**: CIDv1, SHA-256,
raw leaves, balanced layout with 174 links, fixed 262144-byte chunks, wrapped
directory, sorted paths, no modes/timestamps or directory sharding for bounded trees.
The pre-migration fixture still has root
`bafybeiebhql7fgalsvwuy55kkhii3pfukhjdyauualacmnkzeij4z6t6tq` and the same eight blocks.
`importContent(files, put)` remains a compatibility entry point to this Helia import.

`validateContentCar(bytes, expectedRoot?, options?)` parses with `@ipld/car`,
verifies **every** block using `multiformats/block.create`, imports with
`@helia/car`, and checks full root reachability using official
`multiformats/traversal.walk`. It rejects missing roots/blocks, multiple roots,
wrong hashes, unsupported codecs/hashes and blocks outside the root DAG.
The CAR parser alone does **not** verify hashes. Publication requires an explicit
expected root. Defaults bound CAR bytes to 256 MiB, blocks to 16384, and each block
to 2 MiB; positive `ContentCarOptions` limits and cancellation can narrow these.

Traversal/deduplication and CAR framing belong to the official libraries; local
callbacks enforce budgets and UnixFS node policy. No custom link traversal remains.

## Verified Gateway reads

`createIpfsGatewayClient(url)` independently reads standard Trustless Gateway raw
blocks with GET, `?format=raw` and Accept `application/vnd.ipld.raw`. It never uses
RPC. HTTP(S) base URLs must omit credentials, query and fragment; `/base/` and
`/base` both append `/ipfs/{cid}` beneath `/base`. Redirects, non-200 status,
non-raw MIME and encoded responses fail. Streaming reads stop at 2 MiB per block
and time out after 30 seconds (including body reads); caller abort signals cancel
requests. `GatewayClientOptions` can bound bytes/time for programmatic callers.
Use it with `openContent`/`retainContent` for CID verification and existing
DAG/file/retained-total limits, not as an unverified file-download interface.

`openContent(client, cidAndPath, options)` verifies every block with multiformats
before the standard UnixFS exporter interprets it. HTTP gateway fallback uses raw
blocks through the same bounded Gateway reader, forbids redirects and requires
an explicit host access-policy grant. This optional per-request fallback is
separate from choosing a Gateway as the primary client.
`retainContent` verifies every decoded standard DAG link, not only file ranges.
File streams use bounded 256 KiB range windows because the standard exporter has an
eager internal queue; consumer pauses never accumulate whole-file output.

Optional bounded `retainedBlocks` retain verified blocks independently of node GC.
They belong to the caller, not shared Kubo pins. No shared pin is removed.
The old `protectContent`, `protectedBlocks`, `maxProtectedBytes` and
`protectionBudget` names have been replaced by `retainContent`, `retainedBlocks`,
`maxRetainedBytes` and `retentionBudget`; there is no misleading pin/protect alias.
`./testing` provides an offline memory client using the same standard import.

### Why a small HTTP adapter remains

Evaluated `@helia/trustless-gateway-client@1.0.7` with an isolated loopback PoC.
Its routing/broker replaces a configured `/required-base` with `/ipfs/{cid}`,
calls global `fetch` without an injectable transport, and accepts a valid-hash
raw block served as `text/html`. Its `transformRequestInit` hook cannot enforce
response MIME/encoding policy. `@helia/http` and default `@helia/verified-fetch`
use that broker, so switching would lose existing endpoint and transport guarantees.
We retain only the bounded HTTP request/response **policy** adapter above;
UnixFS, codecs, hash checking, CAR framing and DAG traversal use official OSS.
No global fetch override, dependency patch, public router or embedded node is used.

## Independent publication and pinning

`await createIpfsClient(url)` uses `kubo-rpc-client` against an explicitly supplied,
independently managed Kubo RPC endpoint. Engine/service reads remain Gateway-only.
`writeContentCar(bytes, expectedRoot, client, options?)` snapshots and validates
the CAR locally, then calls Kubo `dag.import` with `pinRoots: false`. Kubo stores
the exact CAR blocks; it does not re-chunk files or choose UnixFS import defaults.
Any returned root receipt must match. Kubo may emit no root receipt when pinning
is disabled; a completed import alone is not a pin or an availability guarantee.
`pinContent(cid, client, options?)` separately confirms the requested recursive pin.
`publishContent(files, client)` composes encode, write and pin for compatibility.
The publisher owns the pin; partial upload or failed pin confirmation is not success.

Private endpoint proof: build the workspaces, independently run an offline Kubo
daemon on loopback, then run `node scripts/verify-task-ipfs.mjs` at the repository root.
`IPFS_API` / `IPFS_GATEWAY` default to ports 55001 / 55080. No public swarm or release
is involved. This support package is locally pack-verified, not yet release-authorized.

Alternatively set `PGUIDE_KUBO_BINARY` to an existing Kubo executable and run
`pnpm exec tsx --test --test-concurrency=1 packages\ipfs-content\test\kubo.test.ts`.
The optional test owns an isolated offline repo, ephemeral loopback ports and daemon,
and cleans its process/repo. After a workspace build, `PGUIDE_KUBO_E2E=1` also
runs the full CAR publication → Gateway-only Engine → real Worker proof on that
same owned daemon. Normal tests skip this case when the binary is not specified.
