# @potential-guide/ipfs-content

Generic content/node access, not Task Bundle interpretation. `await createIpfsClient(url)`
uses `kubo-rpc-client` against a caller-managed, independently running local Kubo RPC
endpoint. It never starts, stops or embeds a node. The caller owns transport cleanup.

`importContent(files, put)` uses the standard UnixFS importer: CIDv1, SHA-256,
raw leaves, balanced layout with 174 links, fixed 262144-byte chunks, wrapped directory, sorted paths, no file modes
or timestamps, no directory sharding for supported bounded trees.
`publishContent(files, client)` uploads those exact standard-import blocks via
Kubo block.put, checks each receipt and confirms a recursive root pin, independently
of daemon import defaults. The publisher owns that pin; partial upload is not success.
`openContent(client, cidAndPath, options)` verifies every block with multiformats
before the standard UnixFS exporter interprets it. HTTP gateway fallback uses raw
blocks, forbids redirects and requires an explicit host access-policy grant.
`protectContent` verifies every decoded standard DAG link, not only file ranges.
File streams use bounded 256 KiB range windows because the standard exporter has an
eager internal queue; consumer pauses never accumulate whole-file output.

Optional bounded `protectedBlocks` retain verified blocks independently of node GC.
They belong to the caller, not shared Kubo pins. No shared pin is removed.
`./testing` provides an offline memory client using the same standard import.

Private endpoint proof: build the workspaces, independently run an offline Kubo
daemon on loopback, then run `node scripts/verify-task-ipfs.mjs` at the repository root.
`IPFS_API` / `IPFS_GATEWAY` default to ports 55001 / 55080. No public swarm or release
is involved. This support package is locally pack-verified, not yet release-authorized.
