"""Converte quizzes entre .json e .qv (formato v2 criptografado do QuizzV).

Uso:
    python conversor.py quiz.json   ->  quiz.qv
    python conversor.py quiz.qv     ->  quiz_recuperado.json

A chave é a mesma do app: EXPO_PUBLIC_QV_KEY no ambiente ou no .env.local.
Requer: pip install pynacl
"""

import base64
import json
import os
import sys
from pathlib import Path

from nacl.bindings import (
    crypto_aead_xchacha20poly1305_ietf_decrypt as decrypt,
    crypto_aead_xchacha20poly1305_ietf_encrypt as encrypt,
)
from nacl.utils import random

MAGIC = b"QZV2"  # cabeçalho, também usado como dado autenticado (AAD)
LEGACY_XOR_KEY = 44  # formato antigo (base64 + XOR), só leitura


def carregar_chave():
    chave = os.environ.get("EXPO_PUBLIC_QV_KEY")
    env = Path(__file__).with_name(".env.local")
    if not chave and env.exists():
        for linha in env.read_text().splitlines():
            if linha.startswith("EXPO_PUBLIC_QV_KEY="):
                chave = linha.split("=", 1)[1].strip()
    if not chave or len(chave) != 64:
        sys.exit("Defina EXPO_PUBLIC_QV_KEY (64 caracteres hex) no ambiente ou no .env.local")
    return bytes.fromhex(chave)


def json_para_qv(arquivo, chave):
    dados = json.loads(Path(arquivo).read_text(encoding="utf-8"))
    texto = json.dumps(dados, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    nonce = random(24)
    saida = Path(arquivo).with_suffix(".qv")
    saida.write_bytes(MAGIC + nonce + encrypt(texto, MAGIC, nonce, chave))
    return saida


def qv_para_json(arquivo, chave):
    bruto = Path(arquivo).read_bytes()
    if bruto.startswith(MAGIC):
        nonce, cifrado = bruto[4:28], bruto[28:]
        texto = decrypt(cifrado, MAGIC, nonce, chave)
    else:
        texto = bytes(b ^ LEGACY_XOR_KEY for b in base64.b64decode(bruto))
    dados = json.loads(texto.decode("utf-8"))
    saida = Path(arquivo).with_name(Path(arquivo).stem + "_recuperado.json")
    saida.write_text(json.dumps(dados, indent=4, ensure_ascii=False), encoding="utf-8")
    return saida


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    entrada = sys.argv[1]
    chave = carregar_chave()
    if entrada.lower().endswith(".json"):
        print("Gerado:", json_para_qv(entrada, chave))
    else:
        print("Gerado:", qv_para_json(entrada, chave))
