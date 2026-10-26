import { createContext, type ReactNode, useContext, useState, useSyncExternalStore } from 'react';
import { createPlayer, type Player, type PlayerState } from './player.ts';

const PlayerContext = createContext<Player | null>(null);

/** Owns the app's one audio element; mounted once, above the routes. */
export function PlayerProvider({
  children,
  player: given,
}: {
  readonly children: ReactNode;
  /** For tests: a player over a stub element. */
  readonly player?: Player;
}) {
  const [player] = useState(() => given ?? createPlayer(document.createElement('audio')));
  return <PlayerContext.Provider value={player}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): [PlayerState, Player] {
  const player = useContext(PlayerContext);
  if (!player) throw new Error('usePlayer needs a PlayerProvider.');
  const state = useSyncExternalStore(player.subscribe, player.getState);
  return [state, player];
}
