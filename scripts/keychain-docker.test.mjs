import assert from "node:assert/strict";
import test from "node:test";
import { parseCollection, parseLocked } from "./self-check-docker/keychain.mjs";

test("keychain status distinguishes an uninitialized collection from a real collection", () => {
  assert.equal(parseCollection('method return\n   object path "/"'), undefined);
  assert.equal(
    parseCollection('method return\n   object path "/org/freedesktop/secrets/collection/login"'),
    "/org/freedesktop/secrets/collection/login",
  );
});

test("keychain status never treats malformed lock state as unlocked", () => {
  assert.equal(parseLocked("method return\n   variant       boolean true"), true);
  assert.equal(parseLocked("method return\n   variant       boolean false"), false);
  for (const reply of ["", "false", 'variant string "false"', "variant boolean unknown"])
    assert.throws(() => parseLocked(reply), /Unexpected/);
});

test("keychain status rejects unexpected collection paths", () => {
  for (const reply of [
    "",
    'object path "/some/other/service"',
    'object path "/org/freedesktop/secrets/collection/../login"',
    'object path "/org/freedesktop/secrets/collection/"',
  ])
    assert.throws(() => parseCollection(reply), /Unexpected/);
});
