// Fullplant onboarding UI (docs/gameplay.md §1.5): the step card in the right panel +
// slot pointer highlight + cheap build reveal. One card at a time; palette highlights only
// the next required step. State lives in main.tsx's ONBOARD; this component re-renders via
// the steelx-onboard event.

import * as React from 'react';
import { currentStep, type OnboardingState, type SeqStep } from './onboarding.ts';
import { stepCardView, slotWorld, type StepCardView } from './onboarding_cards.ts';

const { useEffect, useState } = React;

export function notifyOnboard(): void {
  window.dispatchEvent(new CustomEvent('steelx-onboard'));
}

interface Props {
  steps: SeqStep[];
  state: OnboardingState;
  cardsById: Record<string, any>;
  onDismiss: () => void;   // card step -> next
  onBuild: () => void;     // build step confirm -> built + reveal
}

export function OnboardingCard({ steps, state, cardsById, onDismiss, onBuild }: Props) {
  const [, force] = useState(0);
  useEffect(() => {
    const h = () => force((n) => n + 1);
    window.addEventListener('steelx-onboard', h);
    return () => window.removeEventListener('steelx-onboard', h);
  }, []);

  const step = currentStep(steps, state);
  if (!step) return null; // guided flow finished -> quest panel takes over

  // park / resume bridge cards carry no equipment card — copy comes from `note`
  const cardData = (step.type === 'card') ? (cardsById[step.id ?? ''] ?? null)
    : (step.type === 'build') ? (cardsById[step.card_id ?? ''] ?? null)
    : null;
  if (!cardData && step.type !== 'park' && step.type !== 'resume') return null;
  const view: StepCardView = cardData
    ? stepCardView(cardData, step.type === 'build' ? 'build' : 'card')
    : { title: step.type === 'park' ? 'Slice 1 complete — now play it' : 'Quests complete — back to building', body: step.note ?? '', stats: [], action: 'dismiss', actionLabel: step.type === 'park' ? 'Play the Slice 1 quests (the build stays parked until they are done)' : 'Continue building' };

  return (
    <div id="onboard-card">
      <div className="ob-step">{step.type === 'park' ? 'Slice 1 built' : step.type === 'resume' ? 'Back to building' : `Step ${state.index + 1}`}</div>
      <b>{view.title}</b>
      <p>{view.body}</p>
      {view.stats.length > 0 && (
        <table className="ob-stats">{view.stats.map(([k, v]) => <tr key={k}><td>{k}</td><td>{v}</td></tr>)}</table>
      )}
      {view.trivia && <div className="ob-trivia">{view.trivia}</div>}
      <button
        className="ob-action"
        disabled={step.type === 'park'}
        onClick={() => { onBuildOrDismiss(step, onDismiss, onBuild); }}
      >{view.actionLabel}</button>
    </div>
  );
}

function onBuildOrDismiss(step: SeqStep, onDismiss: () => void, onBuild: () => void): void {
  if (step.type === 'build') onBuild();
  else onDismiss(); // park never reaches here: its button is inert (see StepCard)
}

export { slotWorld };
