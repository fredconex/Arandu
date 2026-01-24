// Shared Search History Manager
class SearchHistory {
    constructor(maxHistory = 50) {
        this.maxHistory = maxHistory;
        this.storageKey = 'Arandu-search-history';
        this.history = this.loadHistory();
    }

    loadHistory() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : [];
        } catch (error) {
            console.error('Error loading search history:', error);
            return [];
        }
    }

    saveHistory() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.history));
        } catch (error) {
            console.error('Error saving search history:', error);
        }
    }

    addSearch(term) {
        const trimmedTerm = term.trim();
        if (!trimmedTerm) return;

        // Remove duplicate if it exists
        this.history = this.history.filter(item => item !== trimmedTerm);

        // Add to beginning
        this.history.unshift(trimmedTerm);

        // Limit size
        if (this.history.length > this.maxHistory) {
            this.history = this.history.slice(0, this.maxHistory);
        }

        this.saveHistory();
    }

    removeSearch(term) {
        this.history = this.history.filter(item => item !== term);
        this.saveHistory();
    }

    clearHistory() {
        this.history = [];
        this.saveHistory();
    }

    getHistory(limit = null) {
        if (limit) {
            return this.history.slice(0, limit);
        }
        return [...this.history];
    }

    hasHistory() {
        return this.history.length > 0;
    }
}

// Create global instance
const searchHistory = new SearchHistory();
