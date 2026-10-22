<script lang="ts">
  import type { JoinPolicy } from '../net/protocol';

  // Host-only switches for how newcomers get in. Used in the lobby and the in-game Room sheet.
  let { policy, onchange }: { policy: JoinPolicy; onchange: (p: Partial<JoinPolicy>) => void } = $props();
</script>

<fieldset class="settings">
  <legend>Joining</legend>
  <label class="switch">
    <input type="checkbox" checked={policy.midGameJoins} onchange={(e) => onchange({ midGameJoins: e.currentTarget.checked })} />
    <span>
      Allow players to join mid-game
      <small>Newcomers can take over a bot's seat.</small>
    </span>
  </label>
  <label class="switch">
    <input type="checkbox" checked={policy.autoAssign} onchange={(e) => onchange({ autoAssign: e.currentTarget.checked })} />
    <span>
      Seat newcomers automatically
      <small>Off: they choose which open seat to take.</small>
    </span>
  </label>
</fieldset>

<style>
  .settings {
    margin: 0;
    padding: 8px 12px 10px;
    border: 1px solid var(--line);
    border-radius: 12px;
  }
  legend {
    padding: 0 6px;
    font-weight: 600;
  }
  .switch {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 48px;
    padding: 6px 0;
    cursor: pointer;
  }
  .switch input {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 2px 0 0;
    accent-color: var(--accent);
  }
  small {
    display: block;
    color: var(--muted);
    font-size: 0.8rem;
  }
</style>
