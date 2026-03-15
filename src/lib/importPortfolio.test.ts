import { describe, expect, it } from 'vitest';
import { parseBrokerHoldingsCsv, parseBrokerTransactionsCsv } from './importPortfolio';

describe('parseBrokerHoldingsCsv', () => {
  it('imports holdings, cash, and market values from a broker-style CSV', () => {
    const csv = [
      'Symbol,Name,Shares,Average Cost,Last Price,Market Value,Cash',
      'AAPL,Apple Inc,2,150,175,350,',
      'MSFT,Microsoft,1.5,300,400,600,',
      ',Buying Power,,,,,138.64',
    ].join('\n');

    const { snapshot } = parseBrokerHoldingsCsv(csv, 'broker-holdings.csv');

    expect(snapshot.positions).toHaveLength(2);
    expect(snapshot.positions[0]).toMatchObject({
      symbol: 'AAPL',
      shares: 2,
      costBasis: 150,
      marketValue: 350,
    });
    expect(snapshot.cash).toBe(138.64);
    expect(snapshot.portfolioValue).toBe(1088.64);
  });

  it('detects Fidelity-style holdings exports', () => {
    const csv = [
      'Account Number,Symbol,Description,Quantity,Last Price,Current Value,Average Cost Basis',
      'Z12345,NVDA,NVIDIA CORP,1.5,875,1312.50,620',
    ].join('\n');

    const { snapshot } = parseBrokerHoldingsCsv(csv, 'fidelity-holdings.csv');

    expect(snapshot.format).toBe('fidelity');
    expect(snapshot.positions).toHaveLength(1);
    expect(snapshot.positions[0]).toMatchObject({
      symbol: 'NVDA',
      shares: 1.5,
      costBasis: 620,
      marketValue: 1312.5,
    });
  });

  it('detects Schwab-style holdings exports', () => {
    const csv = [
      'Symbol,Description,Quantity,Price,Market Value,Cost Basis',
      'MSFT,Microsoft Corp,2,420,840,620',
    ].join('\n');

    const { snapshot } = parseBrokerHoldingsCsv(csv, 'schwab-holdings.csv');

    expect(snapshot.format).toBe('schwab');
    expect(snapshot.positions[0]).toMatchObject({
      symbol: 'MSFT',
      shares: 2,
      marketValue: 840,
    });
  });

  it('detects Webull-style holdings exports', () => {
    const csv = [
      'Ticker,Name,Quantity,Cost Price,Last Price,Market Value',
      'TSLA,Tesla Inc,3,180,210,630',
    ].join('\n');

    const { snapshot } = parseBrokerHoldingsCsv(csv, 'webull-holdings.csv');

    expect(snapshot.format).toBe('webull');
    expect(snapshot.positions[0]).toMatchObject({
      symbol: 'TSLA',
      shares: 3,
      costBasis: 180,
      marketValue: 630,
    });
  });
});

describe('parseBrokerTransactionsCsv', () => {
  it('imports buys and separate fees when the CSV includes them', () => {
    const csv = [
      'Date,Action,Symbol,Shares,Price,Amount,Fee,Description',
      '2026-03-10,Buy,AAPL,2,150,300,1.25,Imported buy',
    ].join('\n');

    const { transactions, warnings } = parseBrokerTransactionsCsv(csv, 'broker-transactions.csv');

    expect(warnings).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      kind: 'buy',
      symbol: 'AAPL',
      shares: 2,
      price: 150,
      source: 'system',
    });
    expect(transactions[1]).toMatchObject({
      kind: 'fee',
      symbol: 'AAPL',
      amount: 1.25,
      source: 'system',
    });
  });

  it('turns dividend reinvestment rows into a dividend and a buy', () => {
    const csv = [
      'Date,Action,Symbol,Shares,Price,Amount,Description',
      '03/10/2026,Dividend Reinvestment,MSFT,0.5,400,200,DRIP',
    ].join('\n');

    const { transactions } = parseBrokerTransactionsCsv(csv, 'drip.csv');

    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      kind: 'dividend',
      symbol: 'MSFT',
      amount: 200,
    });
    expect(transactions[1]).toMatchObject({
      kind: 'buy',
      symbol: 'MSFT',
      shares: 0.5,
      price: 400,
    });
  });

  it('detects Robinhood-style rows, extracts tickers, and filters unsupported events', () => {
    const csv = [
      'Date,Instrument,Action,Quantity,Price,Amount',
      '2023-05-01,NVIDIA Corporation (NVDA),Buy,1,285,-285',
      '2023-05-02,NVIDIA Corporation (NVDA),Dividend,,,$0.24',
      '2023-05-03,Cash,Transfer,,,100',
      '2023-05-04,NVIDIA Corporation (NVDA),Option Exercise,1,300,-300',
    ].join('\n');

    const { format, transactions, warnings } = parseBrokerTransactionsCsv(csv, 'robinhood.csv');

    expect(format).toBe('robinhood');
    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toMatchObject({
      kind: 'buy',
      symbol: 'NVDA',
      shares: 1,
      price: 285,
    });
    expect(transactions[1]).toMatchObject({
      kind: 'dividend',
      symbol: 'NVDA',
      amount: 0.24,
    });
    expect(transactions[2]).toMatchObject({
      kind: 'deposit',
      amount: 100,
    });
    expect(warnings).toEqual([
      'Ignored row 5 because "Option Exercise" is not supported in the import pipeline yet.',
    ]);
  });

  it('detects Schwab-style transaction exports', () => {
    const csv = [
      'Date,Action,Symbol,Description,Quantity,Price,Fees & Commissions,Amount',
      '2026-03-10,Buy,AMD,Advanced Micro Devices,2,145,0.65,-290',
    ].join('\n');

    const { format, transactions } = parseBrokerTransactionsCsv(csv, 'schwab-transactions.csv');

    expect(format).toBe('schwab');
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      kind: 'buy',
      symbol: 'AMD',
      shares: 2,
      price: 145,
    });
    expect(transactions[1]).toMatchObject({
      kind: 'fee',
      amount: 0.65,
    });
  });

  it('detects Webull-style transaction exports', () => {
    const csv = [
      'Filled Time,Ticker,Name,Type,Quantity,Filled Price,Amount',
      '2026-03-10 09:31:00,QQQ,Invesco QQQ,Buy,1,500,-500',
    ].join('\n');

    const { format, transactions } = parseBrokerTransactionsCsv(csv, 'webull-transactions.csv');

    expect(format).toBe('webull');
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      kind: 'buy',
      symbol: 'QQQ',
      shares: 1,
      price: 500,
    });
  });
});
