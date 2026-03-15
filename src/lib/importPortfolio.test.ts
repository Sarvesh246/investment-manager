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
});
