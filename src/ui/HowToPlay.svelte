<script lang="ts"></script>

<!-- Rules shown on the start screen. Keep in sync with the engine in src/core. -->
<div class="rules">
  <p>
    Lorris is a team game for 4 or 6 players. You and your teammates win or lose together, but here's the catch:
    you can never see each other's cards or talk about them. You'll have to read your partners through the cards
    they play.
  </p>

  <h3>Teams and Cards</h3>
  <ul>
    <li>
      <b>4 players:</b> Two teams of two, with partners sitting across from each other. The deck uses the 7 through
      Ace of every suit, except the 7 of Spades is swapped out for the <b>Joker</b>.
    </li>
    <li>
      <b>6 players:</b> Two teams of three, seated so that teammates alternate with opponents around the table. The
      deck is a little bigger, with the lowest Spade again swapped for the Joker.
    </li>
  </ul>
  <p>
    Everyone gets 8 cards, and each Set is played over 8 rounds. Shuffling, cutting, and dealing are all handled for
    you.
  </p>

  <h3>Make Your Call</h3>
  <p>
    Before any cards are played, each player in turn (anti-clockwise) either makes a <b>call</b> or passes. A call is
    how many of the 8 rounds you believe your team can win. Calls start at 4, and each new call has to be higher than
    the last, all the way up to 8. If everyone passes, the first player to speak must call 4.
  </p>
  <p>
    Whoever makes the highest call picks the <b>Trump suit</b>. Trump cards beat every card from the other suits, no
    matter their value.
  </p>

  <h3>Playing a Round</h3>
  <ol>
    <li>The first player leads by playing any card. Its suit becomes the suit for that round.</li>
    <li>If you have a card of that suit, you have to play it.</li>
    <li>If you don't, you can play anything you like, including a Trump card to steal the round.</li>
    <li>The highest Trump wins the round. If no Trump was played, the highest card of the round's suit wins.</li>
    <li>Whoever wins the round leads the next one.</li>
  </ol>
  <p>The Set ends as soon as the result is decided, even if not all 8 rounds have been played.</p>

  <h3>The Joker</h3>
  <p>
    The Joker beats everything, Trumps included, and you can play it any time you like. If the Joker is led to start
    a round, everyone else has to play a Trump card if they have one.
  </p>
  <p>
    If one team ends up holding every Trump card and the Joker, the cards are reshuffled and the Set starts over.
    It's not much of a game otherwise!
  </p>

  <h3>Scoring</h3>
  <ul>
    <li><b>Your team made the call and won enough rounds:</b> You score points equal to your call.</li>
    <li>
      <b>Your team made the call and fell short:</b> You lose points equal to your call. The first time your team
      fails a call, you lose <b>double</b>.
    </li>
    <li>
      <b>The other team made the call:</b> You don't score points, but stopping them is how you knock their score
      down.
    </li>
  </ul>
  <p>Scores can go below zero. The first team to reach <b>32 points</b> wins the game.</p>

  <p class="signoff">Bid bravely, play smart, and trust your team.</p>
</div>

<style>
  .rules {
    padding-bottom: 8px;
    line-height: 1.5;
  }
  h3 {
    margin: 18px 0 6px;
    font-size: 1rem;
  }
  p {
    margin: 0 0 8px;
  }
  ul,
  ol {
    margin: 0 0 8px;
    padding-left: 20px;
  }
  li {
    margin-bottom: 4px;
  }
  .signoff {
    margin-top: 14px;
    font-style: italic;
    text-align: center;
    color: var(--muted);
  }
</style>
