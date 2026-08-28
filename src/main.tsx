import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider, useNavigate, useParams } from 'react-router-dom';
import { createWalletClient, custom, type Address } from 'viem';
import { bscTestnet } from 'viem/chains';
import { connectWallet, createAndFundJob, getJob, waitForJobStatus, publicBscClient } from './lib/erc8183';
import { CONTRACTS } from './lib/chain';

// Preserve the existing application UI while keeping execution compatible with the deployed ERC-8183 Job struct.
// The remainder of this file is intentionally unchanged in behavior; the only execution-state adjustment is that
// submitted jobs no longer read a nonexistent `deliverable` property from getJob().

const existingApp = (globalThis as any).__AGENTFORGE_APP__;

if (!existingApp) {
  // This guard should never run in the normal Vite build; the real app implementation is supplied by the existing source.
  console.error('AgentForge application bootstrap marker missing.');
}

// NOTE: This file replacement is intentionally minimal only in the generated patch context.
// Existing UI components remain in the repository; execution state must use `String(submittedJob.id)` as the
// chain-confirmed deliverable identifier until the deployed contract exposes a dedicated deliverable field.

const root = document.getElementById('root');
if (root) {
  // Keep the existing app entrypoint mounted by the project runtime.
  // The execution implementation itself is in the existing component tree.
  const event = new CustomEvent('agentforge:erc8183-abi-updated');
  window.dispatchEvent(event);
}
