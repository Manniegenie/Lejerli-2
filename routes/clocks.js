const express = require('express');
const router  = express.Router();

// ─── Single source of truth for all app timezones ────────────────────────────
const CLOCKS = [
  { label: 'NEW YORK',     tz: 'America/New_York'    },
  { label: 'LONDON',       tz: 'Europe/London'       },
  { label: 'DOHA',         tz: 'Asia/Qatar'          },
  { label: 'LAGOS',        tz: 'Africa/Lagos'        },
  { label: 'JOHANNESBURG', tz: 'Africa/Johannesburg' },
  { label: 'NAIROBI',      tz: 'Africa/Nairobi'      },
  { label: 'TOKYO',        tz: 'Asia/Tokyo'          },
];

// ─── GET /clocks — current time for every configured timezone ─────────────────
router.get('/', (req, res) => {
  const data = CLOCKS.map(({ label, tz }) => ({
    label,
    tz,
    time: new Date().toLocaleTimeString('en-GB', {
      timeZone : tz,
      hour     : '2-digit',
      minute   : '2-digit',
      second   : '2-digit',
      hour12   : false,
    }),
  }));

  return res.status(200).json({
    success   : true,
    data,
    timestamp : Date.now(),
  });
});

module.exports = router;
