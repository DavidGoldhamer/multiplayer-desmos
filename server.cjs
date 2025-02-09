const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = 5555;

// Directory to store graph files
const graphsDir = path.join(__dirname, 'graphs');

// Ensure the graphs directory exists
if (!fs.existsSync(graphsDir)) {
    fs.mkdirSync(graphsDir);
}

app.use(bodyParser.json());
app.use(cors());

// Get all saved graph names or a specific graph by name
app.get('/api/graphs', (req, res) => {
    const { name } = req.query;

    try {
        if (name) {
            // If a specific name is provided, return the corresponding graph file
            const filePath = path.join(graphsDir, `${name}.json`);
            if (fs.existsSync(filePath)) {
                const graph = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                return res.json({ name, data: graph });
            } else {
                return res.status(404).json({ message: `Graph "${name}" not found.` });
            }
        } else {
            // Otherwise, return all graph names
            const files = fs.readdirSync(graphsDir);
            const graphNames = files.map(file => path.parse(file).name); // Only return names
            res.json(graphNames);
        }
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch saved graphs', error });
    }
});

// Save a new graph to a file
app.post('/api/graphs', (req, res) => {
    const { name, data } = req.body;

    if (!name || !data) {
        return res.status(400).json({ message: 'Invalid graph data' });
    }

    try {
        const filePath = path.join(graphsDir, `${name}.json`);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        res.json({ message: `Graph "${name}" saved successfully` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to save graph', error });
    }
});

// Delete a graph file
app.delete('/api/graphs', (req, res) => {
    const { name } = req.query;

    if (!name) {
        return res.status(400).json({ message: 'Graph name is required' });
    }

    const filePath = path.join(graphsDir, `${name}.json`);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ message: `Graph "${name}" not found` });
    }

    try {
        fs.unlinkSync(filePath);
        res.json({ message: `Graph "${name}" deleted successfully` });
    } catch (error) {
        res.status(500).json({ message: 'Failed to delete graph', error });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Backend server running on http://localhost:${PORT}`);
});
