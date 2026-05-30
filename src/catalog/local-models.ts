/**
 * Local model catalog — curated set of coding-friendly open models that
 * pikiclaw recommends for self-hosted backends (Ollama / mlx-lm).
 *
 * Per-backend identifier rules:
 *   - `ollamaTag`  — entry exists in Ollama's library
 *   - `mlxModel`   — HuggingFace repo under `mlx-community/` (Apple Silicon)
 *   Either field is optional; the dashboard filters by backend before display.
 *
 * Sizing rules of thumb (Q4 quants on disk):
 *   weights_gb   ≈ params_b × 0.6
 *   min_ram_gb   ≈ weights_gb × 1.5 + 4   // KV cache + OS headroom
 *
 * `minRamGb` is conservative on purpose.
 */

export interface LocalModelEntry {
  id: string;
  name: string;
  publisher: string;
  /** Approximate parameter count in billions; TOTAL for MoE (RAM tracks total). */
  paramsB: number;
  /** Approx weight footprint at Q4 (GB on disk + memory baseline). */
  sizeGb: number;
  /** Conservative minimum unified-memory recommendation (GB). */
  minRamGb: number;
  description: string;
  descriptionZh: string;
  /** Ollama library tag (https://ollama.com/library/<tag>). */
  ollamaTag?: string;
  /** HuggingFace path under `mlx-community/` for Apple Silicon mlx-lm server. */
  mlxModel?: string;
  homepage?: string;
}

export const LOCAL_MODELS: LocalModelEntry[] = [
  // ── Tier A: 16 GB Macs ─────────────────────────────────────────────────────
  {
    id: 'qwen2.5-coder-7b',
    name: 'Qwen2.5-Coder 7B',
    publisher: 'Alibaba Qwen',
    paramsB: 7,
    sizeGb: 5,
    minRamGb: 16,
    description: 'Compact coding-tuned model; a strong 16 GB Mac default for agent loops.',
    descriptionZh: '面向代码的小模型，16GB Mac 上跑 agent 的稳健选择。',
    ollamaTag: 'qwen2.5-coder:7b',
    mlxModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    homepage: 'https://qwenlm.github.io/blog/qwen2.5-coder/',
  },
  {
    id: 'llama-3.3-8b',
    name: 'Llama 3.3 8B Instruct',
    publisher: 'Meta',
    paramsB: 8,
    sizeGb: 5,
    minRamGb: 16,
    description: 'General-purpose chat; competent tool use, weaker on long-form code edits.',
    descriptionZh: '通用对话模型，工具调用合格，长代码改写偏弱。',
    ollamaTag: 'llama3.3:8b',
    homepage: 'https://www.llama.com/',
  },
  {
    id: 'gemma3-4b',
    name: 'Gemma 3 4B',
    publisher: 'Google DeepMind',
    paramsB: 4,
    sizeGb: 3,
    minRamGb: 8,
    description: 'Smallest entry — runs on 8 GB Macs but tool-use is limited.',
    descriptionZh: '清单里最小的模型，8GB Mac 可跑，工具调用能力有限。',
    ollamaTag: 'gemma3:4b',
    homepage: 'https://ai.google.dev/gemma',
  },
  {
    id: 'deepseek-r1-0528-qwen3-8b',
    name: 'DeepSeek-R1 0528 Qwen3 8B',
    publisher: 'DeepSeek',
    paramsB: 8,
    sizeGb: 5,
    minRamGb: 16,
    description: 'Updated compact reasoning model; useful for debugging, planning, and code review side tasks.',
    descriptionZh: '新版轻量推理模型，适合调试、方案推演和代码审查辅助。',
    ollamaTag: 'deepseek-r1:8b-0528-qwen3-q4_K_M',
    mlxModel: 'mlx-community/DeepSeek-R1-0528-Qwen3-8B-4bit',
    homepage: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
  },

  // ── Tier B: 24-32 GB sweet spot ────────────────────────────────────────────
  {
    id: 'deepseek-coder-v2-lite',
    name: 'DeepSeek-Coder V2 Lite',
    publisher: 'DeepSeek',
    paramsB: 16,
    sizeGb: 10,
    minRamGb: 24,
    description: '16B MoE (~2.4B active) — fast inference + strong code reasoning at mid RAM.',
    descriptionZh: '16B MoE（≈2.4B 激活），中等内存下推理快、代码理解强。',
    ollamaTag: 'deepseek-coder-v2:16b',
    homepage: 'https://github.com/deepseek-ai/DeepSeek-Coder-V2',
  },
  {
    id: 'deepseek-r1-distill-qwen-14b',
    name: 'DeepSeek-R1 Distill Qwen 14B',
    publisher: 'DeepSeek',
    paramsB: 14,
    sizeGb: 9,
    minRamGb: 24,
    description: 'Reasoning-focused Qwen distill; stronger on math/logic than small chat models, but slower for edit loops.',
    descriptionZh: '偏推理的 Qwen 蒸馏模型，数学/逻辑强于小聊天模型，但代码编辑循环会更慢。',
    ollamaTag: 'deepseek-r1:14b-qwen-distill-q4_K_M',
    mlxModel: 'mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit',
    homepage: 'https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
  },
  {
    id: 'phi-4',
    name: 'Phi-4 14B',
    publisher: 'Microsoft',
    paramsB: 14,
    sizeGb: 9,
    minRamGb: 24,
    description: 'Reasoning-tuned 14B; punches above its weight on code and tool tasks.',
    descriptionZh: '14B 推理向模型，代码与工具任务上超出参数量预期。',
    ollamaTag: 'phi4:14b',
    homepage: 'https://huggingface.co/microsoft/phi-4',
  },
  {
    id: 'qwen3-coder-30b-a3b',
    name: 'Qwen3-Coder 30B-A3B',
    publisher: 'Alibaba Qwen',
    paramsB: 30,
    sizeGb: 19,
    minRamGb: 24,
    description: 'Agentic coding upgrade over Qwen2.5-Coder; excellent long-context repo work, tight on 24 GB.',
    descriptionZh: '比 Qwen2.5-Coder 更偏 agentic coding，长上下文仓库任务强；24GB 上属于勉强可跑。',
    ollamaTag: 'qwen3-coder:30b-a3b-q4_K_M',
    mlxModel: 'mlx-community/Qwen3-Coder-30B-A3B-Instruct-4bit',
    homepage: 'https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct',
  },

  // ── Tier S: 36+ GB unified memory ──────────────────────────────────────────
  {
    id: 'qwen2.5-coder-32b',
    name: 'Qwen2.5-Coder 32B',
    publisher: 'Alibaba Qwen',
    paramsB: 32,
    sizeGb: 20,
    minRamGb: 36,
    description: 'Flagship open coding model — needs an Apple Silicon Pro/Max with 36 GB+ unified memory.',
    descriptionZh: '开源代码旗舰，建议 36GB+ 统一内存的 M-Pro/Max。',
    ollamaTag: 'qwen2.5-coder:32b',
    mlxModel: 'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit',
    homepage: 'https://qwenlm.github.io/blog/qwen2.5-coder/',
  },
];
