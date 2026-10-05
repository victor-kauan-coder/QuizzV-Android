// node scripts/qvCodec.test.mjs — checa o formato .qv sem precisar do app.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync } from "node:fs";

process.env.EXPO_PUBLIC_QV_KEY ||= "11".repeat(32);

// Simula o Hermes (Android): sem Symbol.species para Buffer e sem
// DataView.setBigUint64. Foi assim que "undefined is not a function" escapou.
// (o Node reimplementa Buffer#subarray, então trocamos pelo do Uint8Array)
Object.defineProperty(Buffer, Symbol.species, { get: () => Uint8Array });
Buffer.prototype.subarray = function (start, end) {
  const view = new Uint8Array(this.buffer, this.byteOffset, this.byteLength);
  return view.subarray(start, end);
};
delete DataView.prototype.setBigUint64;
assert.ok(!("equals" in Buffer.from("ab").subarray(0, 1)), "simulação do Hermes ativa");

const { decodeQv, encodeQv } = await import("../src/services/qvCodec.js");

const quiz = {
  title: "Direito Constitucional — Ação",
  type: "vf",
  questions: [{ question: "Pergunta?", answer: "Verdadeiro", explanation: "ok" }],
};

// ida e volta
const bytes = encodeQv(quiz);
assert.deepEqual(decodeQv(bytes), quiz);

// cabeçalho binário e conteúdo ilegível
assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), "QZV2");
assert.ok(!Buffer.from(bytes).toString("latin1").includes("Pergunta"));

// nonce aleatório: mesmo quiz gera arquivos diferentes
assert.notDeepEqual(encodeQv(quiz), bytes);

// qualquer byte alterado é rejeitado
const tampered = Uint8Array.from(bytes);
tampered[tampered.length - 5] ^= 1;
assert.throws(() => decodeQv(tampered), /corrompido/);

// chave diferente não abre
const key = process.env.EXPO_PUBLIC_QV_KEY;
process.env.EXPO_PUBLIC_QV_KEY = "22".repeat(32);
assert.throws(() => decodeQv(bytes), /corrompido/);
process.env.EXPO_PUBLIC_QV_KEY = key;

// .qv legado (base64 + XOR 44) e JSON puro continuam importando
const legacy = Buffer.from(
  Buffer.from(JSON.stringify(quiz)).map((b) => b ^ 44),
).toString("base64");
assert.deepEqual(decodeQv(Buffer.from(legacy)), quiz);
assert.deepEqual(decodeQv(Buffer.from("﻿" + JSON.stringify(quiz))), quiz);
assert.throws(() => decodeQv(Buffer.from("não é quiz")), /não é um quiz/);

const fixture = new URL("../teste.qv", import.meta.url);
if (existsSync(fixture)) {
  assert.ok(decodeQv(readFileSync(fixture)).questions.length > 0);
}

console.log("qvCodec ok");
