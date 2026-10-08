<?php
require_once __DIR__.'/env.php';
function calculateOdds($totalA, $totalB, $profitMargin = null)
{
    if ($profitMargin === null) {
        $profitMargin = $_ENV['PROFIT_MARGIN'];
    }
    $totalPool = $totalA + $totalB;

    // Adjust total pool to include profit for bookmaker
    $adjustedPool = $totalPool * (1 - $profitMargin);

    // Avoid division by zero
    $totalA = max($totalA, 1);
    $totalB = max($totalB, 1);

    // Decimal odds formula with bookmaker margin
    $oddsA = $adjustedPool / $totalA;
    $oddsB = $adjustedPool / $totalB;

    return [round($oddsA, 2), round($oddsB, 2)];
}
function placeBet($user, $event, $outcome, $stake)
{
    
}
?>