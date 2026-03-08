import type { MockDataset } from '../domain/types';
import { liveSnapshot } from './liveSnapshot';
import { mockDataset } from './mockData';

export const currentDataset: MockDataset = liveSnapshot ?? mockDataset;
