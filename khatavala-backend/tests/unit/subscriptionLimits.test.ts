describe('Subscription Usage Limits Unit Tests', () => {
  const checkLimit = (currentUsage: number, planLimit: number): boolean => {
    if (planLimit === -1) return true; // Unlimited
    return currentUsage < planLimit;
  };

  it('allows action when usage is strictly below plan limit', () => {
    expect(checkLimit(5, 10)).toBe(true);
    expect(checkLimit(0, 5)).toBe(true);
  });

  it('blocks action when usage reaches or exceeds plan limit', () => {
    expect(checkLimit(10, 10)).toBe(false);
    expect(checkLimit(12, 10)).toBe(false);
  });

  it('allows unlimited usage when plan limit is -1', () => {
    expect(checkLimit(9999, -1)).toBe(true);
  });
});
