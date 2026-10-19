// @vitest-environment jsdom
/**
 * "Loudness from" in the Conductor tool (#378, body-movement A6): reachable from a cold load
 * and does what it says. The shipping rule's test: Conductor (a pinned bar button), Start
 * conducting, Loudness from (three clicks) sets `conductor.expression` through the dial
 * write path; choosing the body while a hand beats composes the pose camera; "Staccato from"
 * appears only while the body shapes the expression, and writes `conductor.articulationFrom`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import ToolsBar from '@/app/ToolsBar';
import ConductorPanel from '@/app/ConductorPanel';
import { useTools } from '@/app/toolsStore';
import { useControls } from '@/app/store';
import { dialsStore } from '@/app/dials/settingsStore';
import { useConductorStatus } from '@/app/conductorStatus';
import { branchIdsFor } from '@/app/graph';
import { dispatchDialSetIn } from '@/app/dispatchDial';
import type { DerivationSettings } from '@/instruments/derive';
import type { ConductorSettings } from '@/settings/schema';
import { BODY } from './helpers/extensions';

const conductor = () => dialsStore.getState().effective.conductor as ConductorSettings;
const derived = () => branchIdsFor(useControls.getState() as unknown as DerivationSettings);

const reset = async () => {
  await dispatchDialSetIn('conductor.enabled', false);
  await dispatchDialSetIn('conductor.source', 'hands');
  await dispatchDialSetIn('conductor.expression', 'same');
  await dispatchDialSetIn('conductor.articulationFrom', 'sharpness');
  await dispatchDialSetIn('conductor.expressionHand', 'auto');
};
beforeEach(async () => {
  useTools.setState({ open: null, independentOpen: {}, launcherOpen: false });
  useConductorStatus.getState().reset();
  await reset();
});
afterEach(async () => {
  cleanup();
  await reset();
});

describe('Loudness from (the split role)', () => {
  it.runIf(BODY)('three clicks from a cold load: Conductor, Start conducting, Loudness from', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    const select = screen.getByTestId('conductor-expression') as HTMLSelectElement;
    expect(select.value).toBe('same');
    // A hand beats and shapes: no articulation choice, no pose camera.
    expect(screen.queryByTestId('conductor-articulation-from')).toBeNull();
    expect(derived()).not.toContain('body-source');

    // The body shapes while the hand beats: the pose camera is composed.
    fireEvent.change(select, { target: { value: 'body' } });
    await waitFor(() => expect(conductor().expression).toBe('body'));
    await waitFor(() => expect(derived()).toEqual(expect.arrayContaining(['conductor', 'body-source'])));
    const art = screen.getByTestId('conductor-articulation-from') as HTMLSelectElement;
    expect(art.value).toBe('sharpness');
    fireEvent.change(art, { target: { value: 'flow' } });
    await waitFor(() => expect(conductor().articulationFrom).toBe('flow'));

    // Back to the hand: the pose camera goes.
    fireEvent.change(select, { target: { value: 'hands' } });
    await waitFor(() => expect(conductor().expression).toBe('hands'));
    await waitFor(() => expect(derived()).not.toContain('body-source'));
    expect(screen.queryByTestId('conductor-articulation-from')).toBeNull();
  });

  it.runIf(BODY)('conducting with the body, the default (same as the beat) offers the articulation choice', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(conductor().source).toBe('body'));
    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    expect(screen.getByTestId('conductor-articulation-from')).toBeTruthy();
    // A hand shapes while the body beats: the articulation is the hand's strokes'.
    fireEvent.change(screen.getByTestId('conductor-expression'), { target: { value: 'hands' } });
    await waitFor(() => expect(conductor().expression).toBe('hands'));
    expect(screen.queryByTestId('conductor-articulation-from')).toBeNull();
    // The body still beats: the pose camera stays.
    expect(derived()).toContain('body-source');
  });

  it.runIf(BODY)('a hand shapes: the shaping hand is a choice (#457), written through the dial', async () => {
    render(
      <>
        <ToolsBar />
        <ConductorPanel />
      </>,
    );
    fireEvent.click(screen.getByText('Conductor'));
    fireEvent.click(screen.getByText('Conduct with body'));
    await waitFor(() => expect(conductor().source).toBe('body'));
    fireEvent.click(screen.getByText('Start conducting'));
    await waitFor(() => expect(conductor().enabled).toBe(true));
    // The body shapes (same as the beat): no hand to choose.
    expect(screen.queryByTestId('conductor-expression-hand')).toBeNull();
    fireEvent.change(screen.getByTestId('conductor-expression'), { target: { value: 'hands' } });
    await waitFor(() => expect(conductor().expression).toBe('hands'));
    const hand = screen.getByTestId('conductor-expression-hand') as HTMLSelectElement;
    expect(hand.value).toBe('auto');
    fireEvent.change(hand, { target: { value: 'left' } });
    await waitFor(() => expect(conductor().expressionHand).toBe('left'));
    // The left hand's gesture needs no pose camera of its own beyond the beating body's.
    expect(derived()).toContain('body-source');
  });
});
