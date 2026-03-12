import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SkillInstallResult {
  status: 'installed' | 'updated' | 'unchanged';
  sourcePath: string;
  targetPath: string;
}

export interface SkillInstallOptions {
  sourcePath?: string;
  targetSkillsDir?: string;
}

function resolveBundledSkillPath(): string | null {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'skills', 'memory', 'SKILL.md'),
    path.resolve(__dirname, '..', '..', '..', 'skills', 'memory', 'SKILL.md'),
  ];

  for (const candidate of candidates) {
    try {
      if (fsSync.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore lookup errors and continue.
    }
  }

  return null;
}

export async function ensureBundledMemorySkillInstalled(
  options: SkillInstallOptions = {}
): Promise<SkillInstallResult> {
  const sourcePath = options.sourcePath || resolveBundledSkillPath();
  if (!sourcePath) {
    throw new Error('Bundled memory skill not found in plugin package');
  }

  const targetSkillsDir =
    options.targetSkillsDir ||
    process.env.OPENCLAW_SKILLS_DIR ||
    path.join(os.homedir(), '.openclaw', 'skills');
  const targetPath = path.join(targetSkillsDir, 'memory', 'SKILL.md');

  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const sourceContent = await fs.readFile(sourcePath, 'utf8');
  let currentContent: string | null = null;
  try {
    currentContent = await fs.readFile(targetPath, 'utf8');
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  if (currentContent === sourceContent) {
    return {
      status: 'unchanged',
      sourcePath,
      targetPath,
    };
  }

  await fs.writeFile(targetPath, sourceContent, 'utf8');
  return {
    status: currentContent === null ? 'installed' : 'updated',
    sourcePath,
    targetPath,
  };
}
