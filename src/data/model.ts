import { buildCommandCenterModel } from '../domain/engine';
import { currentDataset } from './currentDataset';

export const commandCenterModel = buildCommandCenterModel(currentDataset);
