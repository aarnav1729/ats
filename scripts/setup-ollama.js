import { execSync, spawn } from 'child_process';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:7b';

async function isOllamaRunning() {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    return response.ok;
  } catch {
    return false;
  }
}

function startOllamaIfNeeded() {
  const child = spawn('ollama', ['serve'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

async function setup() {
  console.log(`Setting up AI with Ollama and ${OLLAMA_MODEL}...`);

  try {
    execSync('which ollama', { stdio: 'pipe' });
    console.log('Ollama is already installed.');
  } catch {
    console.log('Installing Ollama...');
    try {
      if (process.platform === 'darwin') {
        execSync('brew install ollama', { stdio: 'inherit' });
      } else if (process.platform === 'linux') {
        execSync('curl -fsSL https://ollama.ai/install.sh | sh', { stdio: 'inherit' });
      } else {
        console.log('Please install Ollama manually from https://ollama.ai.');
        return;
      }
    } catch {
      console.log('Could not auto-install Ollama. Please install it manually from https://ollama.ai.');
      console.log('The app will still work, but AI features will use the built-in fallback content.');
      return;
    }
  }

  if (!(await isOllamaRunning())) {
    console.log('Starting the Ollama service...');
    try {
      startOllamaIfNeeded();
      await new Promise((resolve) => setTimeout(resolve, 2500));
    } catch {
      console.log('Could not auto-start Ollama. Start it manually with "ollama serve" if needed.');
    }
  }

  try {
    console.log(`Pulling ${OLLAMA_MODEL}. This may take a few minutes on first run...`);
    execSync(`ollama pull ${OLLAMA_MODEL}`, { stdio: 'inherit', timeout: 900000 });
    console.log(`${OLLAMA_MODEL} is ready.`);
  } catch {
    console.log(`Could not pull ${OLLAMA_MODEL}. Run "ollama pull ${OLLAMA_MODEL}" manually if you want local AI generation.`);
    console.log('The app will still work, and JD generation will fall back to Premier Energies-specific templates.');
  }
}

setup();
