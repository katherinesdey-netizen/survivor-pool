import React from 'react'
import './RulesPage.css'

export default function RulesPage() {
  return (
    <div className="rules-page">
      <h1 className="rules-title">Pool Rules</h1>

      <div className="rules-section">
        <h2>How It Works</h2>
        <p>Each day of the NCAA Tournament, you pick a team to win their game. If your team loses, you're eliminated. Last person standing wins the pot.</p>
      </div>

      <div className="rules-section">
        <h2>Picks</h2>
        <ul>
          <li>Pick <strong>2 teams</strong> on Thursday & Friday of the first week (Round of 64)</li>
          <li>Pick <strong>1 team</strong> on all other tournament days</li>
          <li>You <strong>cannot pick the same team twice</strong> — ever</li>
          <li>Maximum of <strong>12 total picks</strong> across the tournament</li>
        </ul>
      </div>

      <div className="rules-section">
        <h2>Deadlines</h2>
        <ul>
          <li>Picks must be submitted <strong>30 minutes before the first tip-off</strong> of each day</li>
          <li>You can change your picks any time before the deadline — your <strong>most recent submission counts</strong></li>
          <li>If you miss the deadline, you are <strong>automatically assigned the worst-seeded available team</strong> playing in the last game of the day</li>
        </ul>
      </div>

      <div className="rules-section">
        <h2>Elimination</h2>
        <ul>
          <li>If any of your picks loses on a given day, you are <strong>eliminated at the end of that day</strong></li>
          <li>Elimination is day-based — if your pick loses in the morning but someone else's pick loses in the evening, you are both eliminated on the same day</li>
          <li>If multiple participants are eliminated on the same day, it is a <strong>tie — they split the pot equally</strong></li>
        </ul>
      </div>

      <div className="rules-section">
        <h2>Entry & Payment</h2>
        <ul>
          <li>Entry fee is <strong>$25 via Venmo to @adam-furtado</strong></li>
          <li>Payment must be received by <strong>noon ET on the first Thursday</strong> of the tournament</li>
          <li>One entry per person — no re-entries</li>
          <li>Your picks won't count until payment is confirmed by Adam</li>
        </ul>
      </div>

      <div className="rules-section">
        <h2>Edge Cases</h2>
        <ul>
          <li>The First Four games (Tuesday/Wednesday before the tournament) are <strong>not part of the pool</strong>, but you may pick those winners in the Round of 64</li>
          <li>If a participant has used every remaining team, they cannot make a pick but are still alive — they only win if their opponent's pick also loses</li>
        </ul>
      </div>

      <div className="rules-section">
        <h2>The Pot</h2>
        <ul>
          <li>The pot is <strong>number of paid entries × $25</strong></li>
          <li>The last participant(s) standing win the entire pot</li>
          <li>Ties split the pot equally</li>
        </ul>
      </div>
    </div>
  )
}
