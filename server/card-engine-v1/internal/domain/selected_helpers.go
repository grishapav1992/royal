package domain

// Selected unchanged helpers from go_trumpcards (MIT).
func IsJoker(card *Card) bool {
	return card.GetDesign() == CardDesignJoker
}

func evalBestFromSeven(cards []*Card) (int, []*Card) {
	if len(cards) < 5 {
		return PokerHandHighCard, nil
	}
	combos := combinations(cards, 5)
	bestRank := -1
	var bestCards []*Card
	for _, combo := range combos {
		rank := evalFiveCardHand(combo)
		if rank > bestRank || (rank == bestRank && compareHighCardsSlice(combo, bestCards) > 0) {
			bestRank = rank
			bestCards = make([]*Card, 5)
			copy(bestCards, combo)
		}
	}
	return bestRank, bestCards
}

