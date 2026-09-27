<?php
// Lightweight keyword-overlap FAQ matcher — no external API, no per-message
// cost. Each site supplies its own knowledge base array (see
// faqbot_kb_coverage.php / faqbot_kb_florida.php); this file just holds the
// matching logic shared by both.

function faqbot_tokenize($text) {
    $text = strtolower($text);
    $text = preg_replace('/[^a-z0-9\s]/', ' ', $text);
    $words = preg_split('/\s+/', trim($text));
    static $stopwords = [
        'a','an','the','is','are','was','were','do','does','did','i','my','me','you','your',
        'it','to','for','of','on','in','at','and','or','with','can','how','what','whats','when',
        'where','why','will','be','been','have','has','had','need','want','would','could','should',
        'if','this','that','about','there','get','got','please','hi','hello','hey','so','just','also',
        "don't",'dont',"i'm",'im','am',
    ];
    return array_values(array_filter($words, fn($w) => strlen($w) > 1 && !in_array($w, $stopwords, true)));
}

// Returns ['answer' => ..., 'question' => ..., 'score' => ...] or null.
function faqbot_match(array $kb, string $message) {
    $qWords = faqbot_tokenize($message);
    if (!count($qWords)) return null;
    $qSet = array_unique($qWords);

    // Bag of words per entry, plus how many entries each word appears in
    // across the whole KB — a word shared by many entries (a weak, generic
    // signal like "cover" or "work") counts for less than one that's
    // distinctive to a single entry (a strong signal like "mileage").
    $bags = [];
    $df = [];
    foreach ($kb as $i => $entry) {
        $bag = array_unique(faqbot_tokenize($entry['question'] . ' ' . implode(' ', $entry['keywords'] ?? [])));
        $bags[$i] = $bag;
        foreach ($bag as $w) $df[$w] = ($df[$w] ?? 0) + 1;
    }

    $best = null;
    $bestScore = 0;
    foreach ($kb as $i => $entry) {
        $bagSet = $bags[$i];
        if (!count($bagSet)) continue;
        $overlap = array_intersect($qSet, $bagSet);
        if (!count($overlap)) continue;
        $weighted = 0;
        foreach ($overlap as $w) $weighted += 1 / $df[$w];
        $score = $weighted / min(count($qSet), count($bagSet));
        foreach (($entry['phrases'] ?? []) as $phrase) {
            if (stripos($message, $phrase) !== false) $score += 0.4;
        }
        if ($score > $bestScore) { $bestScore = $score; $best = $entry; }
    }

    if ($best && $bestScore >= 0.3) {
        return ['answer' => $best['answer'], 'question' => $best['question'], 'score' => $bestScore];
    }
    return null;
}

function faqbot_wants_human($message) {
    $m = strtolower($message);
    static $phrases = [
        'talk to a person', 'talk to someone', 'speak to a person', 'speak to someone',
        'speak with a person', 'speak with someone', 'human please', 'a real person',
        'talk to the doctor', 'speak to the doctor', 'speak with the doctor',
        'talk to dr', 'speak to dr', 'call me', 'representative',
    ];
    foreach ($phrases as $p) if (strpos($m, $p) !== false) return true;
    return false;
}
