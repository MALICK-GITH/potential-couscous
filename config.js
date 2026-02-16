/**
 * Configuration - FIFA Penalty (sports virtuels 1xbet)
 */
module.exports = {
  api: {
    baseUrl: 'https://1xbet.com/service-api/LiveFeed/Get1x2_VZip',
    timeout: 10000,
  },
  sports: {
    fifa: {
      id: 85,
      name: 'FIFA Penalty',
      keywords: ['FIFA', 'penalty', 'pénalty', 'Penalty'],
    },
  },
  prediction: {
    marginOverround: 0.05,
    minOddsValue: 1.2,
    maxOddsValue: 10,
    ultimateMinOdds: 2.0,
    matchDurationMinutes: 7,
  },
};
