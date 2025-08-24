const path = require('path');
const fs = require('fs');
const pbiviz = JSON.parse(fs.readFileSync('pbiviz.json', 'utf8'));
const visualName = pbiviz.visual.name;

module.exports = {
    entry: {
        visual: './src/visual.ts'
    },
    devtool: 'source-map',
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader',
                exclude: /node_modules/
            },
            {
                test: /\.less$/,
                use: [
                    'style-loader',
                    'css-loader',
                    'less-loader'
                ]
            }
        ]
    },
    resolve: {
        extensions: ['.tsx', '.ts', '.js']
    },
    output: {
        path: path.resolve(__dirname, '.tmp/drop'),
        filename: 'visual.js',
        library: visualName,
        libraryTarget: 'var'
    },
    externals: {
        'powerbi-visuals-api': 'powerbi'
    }
};