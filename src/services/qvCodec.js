import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { managedNonce, randomBytes } from "@noble/ciphers/utils.js";
import { Buffer } from "buffer";

// Formato .qv v2 (binário): "QZV2" | nonce (24 bytes) | JSON cifrado + tag Poly1305.
// O cabeçalho entra como AAD, então qualquer byte alterado invalida o arquivo.
export const QV_MIME = "application/vnd.quizzv";
const MAGIC = Buffer.from("QZV2", "ascii");
const LEGACY_XOR_KEY = 44; // formato v1 (base64 + XOR), só leitura

// A chave vem do build (.env.local / variável do EAS) e nunca fica no repositório.
const getKey = () => {
  const hex = process.env.EXPO_PUBLIC_QV_KEY;
  if (!/^[0-9a-fA-F]{64}$/.test(hex || "")) {
    throw new Error(
      "Chave de criptografia .qv não configurada (EXPO_PUBLIC_QV_KEY).",
    );
  }
  return Uint8Array.from(Buffer.from(hex, "hex"));
};

const cipher = (rng) =>
  managedNonce(xchacha20poly1305, rng)(getKey(), Uint8Array.from(MAGIC));

/** Objeto JS -> bytes .qv criptografados. `rng` permite injetar o gerador nativo. */
export const encodeQv = (data, rng = randomBytes) => {
  const plain = Uint8Array.from(Buffer.from(JSON.stringify(data), "utf8"));
  return Uint8Array.from(
    Buffer.concat([MAGIC, Buffer.from(cipher(rng).encrypt(plain))]),
  );
};

const parseLegacy = (text) => {
  const compact = text.replace(/\s/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(compact)) return null;
  const bytes = Buffer.from(compact, "base64").map((b) => b ^ LEGACY_XOR_KEY);
  try {
    return JSON.parse(Buffer.from(bytes).toString("utf8"));
  } catch {
    return null;
  }
};

/** Bytes de um .qv (v2 ou legado) ou .json -> objeto JS. */
export const decodeQv = (bytes) => {
  const buf = Buffer.from(bytes);
  if (buf.subarray(0, MAGIC.length).equals(MAGIC)) {
    let plain;
    try {
      plain = cipher().decrypt(Uint8Array.from(buf.subarray(MAGIC.length)));
    } catch {
      throw new Error(
        "Arquivo .qv corrompido ou criado por outra versão do QuizzV.",
      );
    }
    return JSON.parse(Buffer.from(plain).toString("utf8"));
  }

  const text = buf.toString("utf8").replace(/^﻿/, "").trim();
  const legacy = parseLegacy(text);
  if (legacy) return legacy;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Este arquivo não é um quiz do QuizzV.");
  }
};
