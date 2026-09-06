import { create } from 'zustand';
import type { LogLevel } from '../../services/logger';

export type ConsoleFilter = 'ALL' | LogLevel;

interface ConsoleState {
  isOpen: boolean;
  filter: ConsoleFilter;
  searchQuery: string;
  autoScroll: boolean;
  drawerHeight: number;
  commandHistory: string[];
  historyIndex: number;

  toggleConsole: () => void;
  openConsole: () => void;
  closeConsole: () => void;
  setFilter: (filter: ConsoleFilter) => void;
  setSearchQuery: (query: string) => void;
  setAutoScroll: (enabled: boolean) => void;
  setDrawerHeight: (height: number) => void;
  addToHistory: (command: string) => void;
  navigateHistory: (direction: 'up' | 'down') => void;
  resetHistoryIndex: () => void;
}

export const useConsoleStore = create<ConsoleState>((set) => ({
  isOpen: false,
  filter: 'ALL',
  searchQuery: '',
  autoScroll: true,
  drawerHeight: 300,
  commandHistory: [],
  historyIndex: -1,

  toggleConsole: () => set((state) => ({ isOpen: !state.isOpen })),
  openConsole: () => set({ isOpen: true }),
  closeConsole: () => set({ isOpen: false }),
  setFilter: (filter) => set({ filter }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setAutoScroll: (autoScroll) => set({ autoScroll }),
  setDrawerHeight: (drawerHeight) => set({ drawerHeight: Math.max(150, Math.min(600, drawerHeight)) }),
  addToHistory: (command) => set((state) => ({
    commandHistory: [command, ...state.commandHistory].slice(0, 100),
    historyIndex: -1,
  })),
  navigateHistory: (direction) => set((state) => {
    if (state.commandHistory.length === 0) return state;
    const newIndex = direction === 'up'
      ? Math.min(state.historyIndex + 1, state.commandHistory.length - 1)
      : Math.max(state.historyIndex - 1, -1);
    return { historyIndex: newIndex };
  }),
  resetHistoryIndex: () => set({ historyIndex: -1 }),
}));
