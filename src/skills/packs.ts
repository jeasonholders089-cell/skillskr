import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "../lib/zip.ts";
import type { PublicSkill } from "../repos/skills.ts";

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(here, "..", "..");

/**
 * Authored packs live here:
 *
 *   packs/<slug>/SKILL.md
 *   packs/<slug>/templates/...
 *
 * Drop real content in and it is shipped verbatim. When a folder is absent we
 * generate a scaffold from the catalog metadata instead, so the download flow is
 * real end to end without pretending to ship someone else's assets.
 */
export const PACKS_DIR = join(projectRoot, "packs");

export const PACK_VERSION = "1.0.0";

export interface PackFile {
  name: string;
  data: Buffer | string;
}

function walk(dir: string, prefix = ""): PackFile[] {
  const files: PackFile[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(full).isDirectory()) {
      files.push(...walk(full, rel));
    } else {
      files.push({ name: rel, data: readFileSync(full) });
    }
  }
  return files;
}

function frontmatter(skill: PublicSkill): string {
  return [
    "---",
    `name: ${skill.title}`,
    `description: ${skill.summary ?? `${skill.title} — a ${skill.output} workflow for AI coding agents.`}`,
    `version: ${PACK_VERSION}`,
    "license: commercial",
    "metadata:",
    `  skillry_slug: ${skill.slug}`,
    `  output: ${skill.output}`,
    `  tier: ${skill.free ? "free" : "pro"}`,
    "---",
  ].join("\n");
}

function scaffoldSkillMd(skill: PublicSkill): string {
  return `${frontmatter(skill)}

# ${skill.title}

${skill.summary ?? `A ${skill.output.toLowerCase()} Skill from the Skillry studio.`}

## When to use this Skill

Use it when the user asks for ${skill.output.toLowerCase()} work that should match
the result shown on the Skill page: given source material, produce the same kind
of output in the same visual language.

## What the agent should do

1. Read the user's brief and collect the source material.
2. Follow the layout, type and colour decisions described in this Skill.
3. Produce the deliverable in the requested format.
4. Show the result, then offer one round of refinements.

## Working with tools

${skill.tools.length ? skill.tools.map((tool) => `- ${tool.name}`).join("\n") : "- Any agent that can read SKILL.md"}

## Notes

This scaffold came from the catalog entry. Replace it with the authored
workflow before shipping it to customers.
`;
}

function scaffoldManifest(skill: PublicSkill): string {
  return JSON.stringify(
    {
      slug: skill.slug,
      title: skill.title,
      version: PACK_VERSION,
      output: skill.output,
      tier: skill.free ? "free" : "pro",
      tools: skill.tools.map((tool) => tool.name),
      generatedFrom: "catalog-metadata",
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

function scaffoldReadme(skill: PublicSkill): string {
  return `# ${skill.title}

## Install

1. Unzip this folder.
2. Move it into your agent's skills directory:
   - Claude Code: \`.claude/skills/${skill.slug}/\`
   - Codex: \`.codex/skills/${skill.slug}/\`
   - Cursor: \`.cursor/skills/${skill.slug}/\`
3. Ask your agent to use the Skill.

The pack contains \`SKILL.md\` (the instructions), \`manifest.json\` (metadata)
and this README.
`;
}

/** Build the ZIP for a skill: authored files when present, scaffold otherwise. */
export function buildPack(skill: PublicSkill): { buffer: Buffer; authored: boolean } {
  const authoredDir = join(PACKS_DIR, skill.slug);
  if (existsSync(authoredDir) && statSync(authoredDir).isDirectory()) {
    const files = walk(authoredDir);
    if (files.length > 0) {
      return { buffer: createZip(files), authored: true };
    }
  }

  const files: PackFile[] = [
    { name: "SKILL.md", data: scaffoldSkillMd(skill) },
    { name: "manifest.json", data: scaffoldManifest(skill) },
    { name: "README.md", data: scaffoldReadme(skill) },
  ];
  return { buffer: createZip(files), authored: false };
}

export function packFileName(skill: PublicSkill): string {
  return `${skill.slug}-v${PACK_VERSION}.zip`;
}
