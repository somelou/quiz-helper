# Quiz Helper

[**English**](./README.en.md) | [中文](./README.md)

<p align="center">
  <img src="./docs/previews/png/quiz-helper-small-tile-440x280.png" alt="Quiz Helper" width="440" />
</p>

A browser extension for web-based quiz questions.

It extracts question content from the current page, calls the LLM API configured by you to generate reference answers, and supports question-bank matching, AI selection parsing, and web-search enhancement.

<p align="center">
  <a href="https://github.com/somelou/quiz-helper/releases"><img src="https://img.shields.io/github/v/release/somelou/quiz-helper?color=369eff&labelColor=black&logo=github&logoColor=white&style=flat-square" alt="GitHub Release" /></a>
  <a href="https://github.com/somelou/quiz-helper/stargazers"><img src="https://img.shields.io/github/stars/somelou/quiz-helper?color=ffcb47&labelColor=black&style=flat-square" alt="GitHub Stars" /></a>
  <a href="https://github.com/somelou/quiz-helper/network/members"><img src="https://img.shields.io/github/forks/somelou/quiz-helper?color=8ae8ff&labelColor=black&style=flat-square" alt="GitHub Forks" /></a>
  <a href="https://github.com/somelou/quiz-helper/issues"><img src="https://img.shields.io/github/issues/somelou/quiz-helper?color=ff80eb&labelColor=black&style=flat-square" alt="GitHub Issues" /></a>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?logo=javascript&logoColor=black&style=flat-square" alt="JavaScript" />
  <img src="https://img.shields.io/badge/Manifest%20V3-4285F4?style=flat-square" alt="Manifest V3" />
  <img src="https://img.shields.io/badge/Chrome-4285F4?style=flat-square" alt="Chrome" />
  <img src="https://img.shields.io/badge/Edge-0A60BE?style=flat-square" alt="Microsoft Edge" />
</p>

## Key Features

- Page question extraction: recognize and extract questions, options, and question types from the current page
- AI reference answers: call your configured LLM API to generate reference answers question by question
- Streaming output control: global toggle for streaming responses in model tests and answering
- AI selection parsing: manually select a page region and let AI parse the local question content
- Question-bank import & matching: import question banks and prioritize question-bank matching when answering
- Web-search enhancement: combine search results to help generate answers when needed
- History management: save local analysis records with viewing, export, and cleanup
- Backup & restore: export/import local configs and data by module
- Theme & shortcuts: light/dark theme and panel shortcut configuration
- Bilingual support: UI copy and AI prompts automatically switch between Chinese and English based on the browser UI language

<p align="center">
  <img src="./docs/previews/png/01-one-click-solve.png" alt="One-click solving" width="720" />
</p>

## Language Support

The extension supports both Chinese and English out of the box, with no configuration needed — it follows your browser's UI language automatically:

- **UI copy**: popup, options page, and on-page panel copy switch automatically (English UI shows English; otherwise Chinese by default)
- **AI prompts**: prompt templates are loaded by language, ensuring high-quality reference answers for both Chinese and English questions
- **Fallback**: untranslated copy keeps Chinese defaults; usage is unaffected

## Installation

### Option 1: Install from the Store

Search for "题目助手" (Quiz Helper) in the Microsoft Edge Add-ons store, or install directly from the link below:

<https://microsoftedge.microsoft.com/addons/detail/%E9%A2%98%E7%9B%AE%E5%8A%A9%E6%89%8B/enmbkdjfpdjpmnjmpnfhfkhkhljkoiji>

### Option 2: Offline Installation

This repository can be loaded as an unpacked extension in Chrome or Edge.

1. Get the project source code.
2. Open the browser extensions management page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on "Developer mode" (top right).
4. Click "Load unpacked".
5. Select the extension directory: `quiz-helper/src/`.
6. Once installed, the "Quiz Helper" entry will appear in the browser toolbar.

## First-time Setup

Before first use, it is recommended to complete the following:

1. Click "Open Settings" in the extension popup.
2. Add at least one available LLM configuration on the settings page.
3. Fill in the required info: model API URL, API key, model name, etc.
4. Optionally enable web search and configure the search provider parameters.
5. Optionally import a question bank for later matching and validation.
6. Save the settings.

> Without a model configuration, the extension cannot generate reference answers.

## Usage

### 1. Analyze Questions on the Current Page

1. Open the target page that contains questions.
2. Click the "Quiz Helper" icon in the browser toolbar (or use the shortcut key).
3. Click "Analyze Current Page Questions" in the popup.
4. The extension injects the panel into the current page and automatically extracts the questions.
5. Wait for the reference answers to be generated one by one.

### 2. Use the On-page Panel

In the on-page panel, you can:

- View question content, types, and reference answers
- View deep-thinking progress and streaming output
- View question-bank matching and validation results
- Pause or resume the analysis flow
- Re-answer the current result
- Trigger rule re-parsing
- Use AI selection parsing to extract local content

### 3. Use the Settings Page

The settings page is mainly for:

- Managing model configs (OpenAI / Anthropic / Responses API formats)
- Toggling streaming output (whether tests and answers stream character by character)
- Configuring web search
- Managing parsing rules
- Importing and maintaining question banks
- Viewing, exporting, and clearing history
- Backing up and restoring local data
- Configuring theme and shortcuts

## Use Cases

This extension is best suited for:

- Extracting questions from online practice platforms
- Web question assistance and analysis
- Scenarios that need reference matching with a question bank
- Complex pages that require manual selection parsing for partial content

Since different sites have different DOM structures, some pages may require parsing rules or the AI selection parsing feature.

## FAQ

**Q: How do I enable web search for models with built-in web search, like DeepSeek-v4 Flash?**

A: DeepSeek-v4 Flash has built-in web search. In the settings page's "Model Management", when adding/editing a model, set the **API Format** to **Responses** and add `web_search` under "Built-in Tools". Other models with built-in web search can be configured the same way.

## Permissions & Privacy

Main permissions used by the extension:

- `storage`: save local configs, question banks, and history
- `activeTab`: access the current page only when triggered by the user
- `scripting`: inject content scripts and the panel into pages
- `declarativeNetRequest`: support some web-search / request handling
- `host_permissions: <all_urls>`: work on any page when actively used by the user

Privacy principles:

- User configs, question banks, and history are stored locally in the browser by default
- Question content is sent directly to the third-party model service you configure
- Requests never pass through the developer's server
- No tracking, ads, or third-party analytics code

See [PRIVACY.md](./PRIVACY.md) for details.

## Project Structure

If you'd like to dig deeper, start with these directories:

- `src/popup/`: browser toolbar popup page
- `src/options/`: settings page
- `src/content/`: injected panel and question parsing logic
- `src/background/`: background message routing, AI requests, question-bank and search capabilities
- `src/shared/`: shared constants and utilities
- `src/data/`: default parsing rules and prompt templates

## Related Documents

- [Privacy Policy](./PRIVACY.md)
- [Page structure guide](./docs/structure.md)
- [Project maintenance guide](./AGENTS.md)

## Current Version

- Manifest Version: `3`
- Extension Version: `3.1.0`
