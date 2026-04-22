#!/usr/bin/env python3
"""Compress an LLM prompt using LLMLingua-2 to reduce token usage.

Usage: echo "prompt text" | python compress-prompt.py [--rate 0.5]
Output: JSON with compressed_prompt, original/compressed token counts, ratio.

The model is loaded once and cached in memory. First run downloads
the model (~180MB) from HuggingFace.
"""
import sys
import json
import os

# Suppress HF warnings
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--rate", type=float, default=0.4, help="Compression rate (0.3 = 3x, 0.5 = 2x)")
    args = parser.parse_args()

    prompt = sys.stdin.read()
    if not prompt.strip():
        json.dump({"compressed_prompt": "", "origin_tokens": 0, "compressed_tokens": 0, "ratio": "1.0x"}, sys.stdout)
        return

    # Skip compression for short prompts (not worth the overhead)
    if len(prompt) < 200:
        json.dump({"compressed_prompt": prompt, "origin_tokens": len(prompt.split()), "compressed_tokens": len(prompt.split()), "ratio": "1.0x", "skipped": True}, sys.stdout)
        return

    try:
        from llmlingua import PromptCompressor

        compressor = PromptCompressor(
            model_name="microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank",
            use_llmlingua2=True,
            device_map="cpu",
        )

        result = compressor.compress_prompt(
            prompt,
            rate=args.rate,
            force_tokens=['\n', '?', ':', '(', ')', '-', '>', '.', '/'],
        )

        json.dump({
            "compressed_prompt": result["compressed_prompt"],
            "origin_tokens": result["origin_tokens"],
            "compressed_tokens": result["compressed_tokens"],
            "ratio": result["ratio"],
        }, sys.stdout)

    except Exception as e:
        # On error, return the original prompt (fail-open)
        json.dump({
            "compressed_prompt": prompt,
            "origin_tokens": len(prompt.split()),
            "compressed_tokens": len(prompt.split()),
            "ratio": "1.0x",
            "error": str(e),
        }, sys.stdout)

if __name__ == "__main__":
    main()
