import { describe, expect, it, vi } from 'vitest';
import { Charturbo } from '../sdk/charturbo';
import { graphBackend } from './graph-backend';

describe('GPU-resident physics', () => {
  it('resolves steps at submission and syncs the CPU copy only on request', async () => {
    const { backend } = graphBackend();
    backend.request_gpu_physics = vi.fn(async () => [0, 12.5] as [number, number]);
    backend.request_physics_sync = vi.fn(async () => 7);
    backend.complete_physics_sync = vi.fn();
    const sdk = Charturbo.fromBackend(backend);
    await expect(sdk.stepPhysicsAsync(0.016)).resolves.toBe(12.5);
    expect(backend.complete_physics_sync).not.toHaveBeenCalled();
    await sdk.syncPhysicsPositions();
    expect(backend.complete_physics_sync).toHaveBeenCalledWith(7);
    // Ticket 0: the CPU copy is already current.
    vi.mocked(backend.request_physics_sync!).mockResolvedValueOnce(0);
    await sdk.syncPhysicsPositions();
    expect(backend.complete_physics_sync).toHaveBeenCalledOnce();
    sdk.dispose();
  });

  it('falls back to CPU steps and rejects work finishing after disposal', async () => {
    const { backend } = graphBackend();
    backend.step_physics = vi.fn(() => 3);
    const cpu = Charturbo.fromBackend(backend);
    await expect(cpu.stepPhysicsAsync()).resolves.toBe(3);
    await expect(cpu.syncPhysicsPositions()).resolves.toBeUndefined();
    cpu.dispose();

    const gpu = graphBackend().backend;
    gpu.request_gpu_physics = vi.fn(async () => [0, 1] as [number, number]);
    gpu.request_physics_sync = vi.fn(async () => 1);
    gpu.complete_physics_sync = vi.fn();
    const sdk = Charturbo.fromBackend(gpu);
    const pending = sdk.syncPhysicsPositions();
    sdk.dispose();
    await expect(pending).rejects.toThrow(/disposed/);
    expect(gpu.complete_physics_sync).not.toHaveBeenCalled();
    await expect(sdk.stepPhysicsAsync()).rejects.toThrow(/disposed/);
  });
});
