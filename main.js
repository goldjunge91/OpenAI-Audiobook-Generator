// Add isGenerating state to prevent duplicate generations
let isGenerating = false;
let generationId = null;

document.getElementById('generate-audiobook').addEventListener('click', handleGeneration);

console.log("Version 0.9.1");

async function handleGeneration() {
    // prevent for duplicate generation
    if (isGenerating) {
        console.log("Generation already in progress");
        return;
    }
    const button = document.getElementById('generate-audiobook');
    const errorIndicator = document.getElementById("error-indicator");

    // Visual feedback - disable button and show processing state
    button.disabled = true;
    button.classList.add("Processing");
    button.textContent = "Processing....";
    isGenerating = true;

    // Generate unique ID 
    generateId = Date.now().toString();
    try {
        await generateAudiobook();
    } catch (error) {
        console.error("Error in generation:", error);
        errorIndicator.style.display = 'block';
    } finally {
        button.disabled = false;
        button.classList.remove("Processing");
        button.textContent = "Generate AudioBook";
        isGenerating = false;
        generateId = null;
    }
}

async function mergeAudioBlobsAndDownload(audioBlobs) {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const buffers = [];

    // Decode MP3 blobs into AudioBuffers
    for (const blob of audioBlobs) {
        const arrayBuffer = await blob.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        buffers.push(audioBuffer);
    }

    // Convert AudioBuffers to WAV and concatenate
    const wavBuffers = buffers.map(buffer => audioBufferToWAV(buffer));
    const concatenatedWav = concatenateWAVBuffers(wavBuffers);

    // Trigger download of concatenated WAV file
    triggerDownload(new Blob([concatenatedWav], {type: 'audio/wav'}), 'merged_audio.wav');
}

function audioBufferToWAV(buffer) {
    // Convert an AudioBuffer to a WAV Blob using audiobuffer-to-wav
    return audioBufferToWav(buffer);
}

function concatenateWAVBuffers(wavBuffers) {
    // Extract and sum the lengths of the data chunks (excluding headers)
    const dataLength = wavBuffers.reduce((acc, buffer) => acc + (buffer.byteLength - 44), 0);

    // Create a new buffer to hold the concatenated WAV file
    const concatenatedBuffer = new Uint8Array(44 + dataLength);

    // Copy the header from the first buffer (44 bytes)
    concatenatedBuffer.set(new Uint8Array(wavBuffers[0].slice(0, 44)));

    const totalSize = 36 + dataLength;
    concatenatedBuffer[4] = (totalSize & 0xff);
    concatenatedBuffer[5] = ((totalSize >> 8) & 0xff);
    concatenatedBuffer[6] = ((totalSize >> 16) & 0xff);
    concatenatedBuffer[7] = ((totalSize >> 24) & 0xff);

    const dataSize = dataLength;
    concatenatedBuffer[40] = (dataSize & 0xff);
    concatenatedBuffer[41] = ((dataSize >> 8) & 0xff);
    concatenatedBuffer[42] = ((dataSize >> 16) & 0xff);
    concatenatedBuffer[43] = ((dataSize >> 24) & 0xff);

    // Concatenate the actual data chunks
    let offset = 44;
    var progressBar = document.getElementById('progressbar2');
    progressBar.max = totalSize;
    progressBar.value = offset;

    wavBuffers.forEach(buffer => {
        concatenatedBuffer.set(new Uint8Array(buffer.slice(44)), offset);
        offset += buffer.byteLength - 44;
        progressBar.value = offset;
    });
    console.log("Individual buffer sizes:", wavBuffers.map(b => b.byteLength));
    console.log("Concatenated buffer size:", concatenatedBuffer.byteLength);

    return concatenatedBuffer.buffer;
}

function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}

function generateAudiobook() {
    var text = document.getElementById('text-input').value;
    var apiKey = document.getElementById('api-key').value;
    var currentGenerationId = generationId;  // Store current generation ID

    var segments = splitTextIntoSegments(text, 4000);
    var audioBlobs = new Array(segments.length);
    var progressBar = document.getElementById('progressbar1');
    document.getElementById('error-indicator').style.display = 'none';
    progressBar.max = segments.length;
    progressBar.value = 0;

    // Queue for segment processing
    var queue = segments.slice(); // Clone the segments array
    var rateLimitPerMinute = 50;
    var delayBetweenCalls = 60000 / rateLimitPerMinute; // Delay in ms

    function processQueue() {
        if (queue.length === 0) return; // Stop if the queue is empty

        var index = segments.length - queue.length;
        var segment = queue.shift(); // Get the next segment from the queue

        callOpenAIAPI(segment, apiKey, function (audioBlob) {
            audioBlobs[index] = audioBlob;
            progressBar.value = audioBlobs.filter(Boolean).length;

            if (audioBlobs.filter(Boolean).length === segments.length) {
                mergeAudioBlobsAndDownload(audioBlobs);
            } else {
                setTimeout(processQueue, delayBetweenCalls); // Process the next segment after a delay
            }
        });
    }

    // Start processing the queue
    processQueue();
}


function splitTextIntoSegments(text, maxLength) {
    var segments = [];
    var currentSegment = '';

    text.split('. ').forEach(sentence => {
        if (currentSegment.length + sentence.length > maxLength) {
            segments.push(currentSegment);
            currentSegment = '';
        }
        currentSegment += sentence + '. ';
    });

    if (currentSegment.trim() !== '') {
        segments.push(currentSegment);
    }

    return segments;
}

function callOpenAIAPI(segment, apiKey, callback) {
    var xhr = new XMLHttpRequest();
    xhr.open("POST", "https://api.openai.com/v1/audio/speech", true);
    xhr.setRequestHeader("Authorization", "Bearer " + apiKey);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.responseType = 'blob';

    xhr.onload = function () {
        if (xhr.status === 200) {
            var audioBlob = xhr.response;
            callback(audioBlob);
        } else {
            console.error("Error calling OpenAI API: " + xhr.statusText);
            document.getElementById('error-indicator').style.display = 'block';
        }
    };

    console.log("TTS running for: ");
    console.log(segment);

    var data = JSON.stringify({
        "model": "tts-1",
        "input": segment,
        "voice": document.getElementById("voice").value
    });
    xhr.send(data);
}

document.addEventListener('DOMContentLoaded', function () {
    var textInput = document.getElementById('text-input');
    var fileUpload = document.getElementById('file-upload');
    var costDisplay = document.getElementById('cost-estimate-display');

    fileUpload.addEventListener('change', handleFileUpload);
    textInput.addEventListener('input', calculateCost);

    function calculateCost() {
        var textLength = textInput.value.length;
        var cost = (textLength / 1000) * 0.015;
        costDisplay.textContent = 'Estimated Cost for Conversion: $' + cost.toFixed(2);
    }

    function handleFileUpload(event) {
        var file = event.target.files[0];
        console.log('File uploaded:', file.name, 'Type:', file.type); // Debug log

        if (file) {
            if (file.type === 'text/plain') {
                var reader = new FileReader();
                reader.onload = function (e) {
                    textInput.value = e.target.result;
                    calculateCost();
                };
                reader.readAsText(file);
            } else if (file.type === 'application/pdf') {
                console.log('Processing PDF file'); // Debug log
                var reader = new FileReader();
                reader.onload = function(e) {
                    console.log('PDF loaded into reader'); // Debug log
                    const arrayBuffer = e.target.result;
                    pdfjsLib.getDocument(arrayBuffer).promise
                        .then(function(pdf) {
                            console.log('PDF document loaded, pages:', pdf.numPages); // Debug log
                            let fullText = '';
                            const progressBar = document.getElementById('progressbar1');
                            progressBar.max = pdf.numPages;
                            progressBar.value = 0;
                            
                            let promise = Promise.resolve();
                            for (let i = 1; i <= pdf.numPages; i++) {
                                promise = promise
                                    .then(() => {
                                        console.log('Processing page:', i); // Debug log
                                        return pdf.getPage(i);
                                    })
                                    .then((page) => page.getTextContent())
                                    // .then((content) => {
                                    //     const pageText = content.items
                                    //         .map(item => item.str)
                                    //         .join(' ');
                                    //     console.log(`Page ${i} first 100 chars:`, pageText.substring(0, 100)); // Debug log
                                    //     fullText += pageText + '\n\n';
                                    //     progressBar.value = i;
                                    // });
                                    // Update this part of the handleFileUpload function:
                                .then((content) => {
                                    console.log('Raw content items:', content.items); // Debug what's in the content
                                    const pageText = content.items
                                        .map(item => {
                                            console.log('Item:', item); // Debug individual items
                                            return item.str;
                                        })
                                        .join(' ');
                                    console.log(`Page ${i} raw text:`, pageText); // Show the actual text
                                    fullText += pageText + '\n\n';
                                    progressBar.value = i;
                                });
                            }
                            
                            return promise.then(() => fullText);
                        })
                        .then((text) => {
                            console.log('Total text extracted length:', text.length); // Debug log
                            const cleanedText = cleanPDFText(text);
                            console.log('Cleaned text length:', cleanedText.length); // Debug log
                            document.getElementById('text-input').value = cleanedText;
                            calculateCost();
                        })
                        .catch(function(error) {
                            console.error('Error reading PDF:', error);
                            alert('Error reading PDF file.');
                        });
                };
                reader.readAsArrayBuffer(file);
            } else if (file.name.endsWith('.epub')) {
                var reader = new FileReader();
                reader.onload = function (e) {
                    var epubContent = e.target.result;
                    readEpub(epubContent);
                };
                reader.readAsBinaryString(file);
            } else {
                alert('Please upload a text, PDF, or ePub file.');
            }
        }
    }

    function readEpub(epubContent) {
        var new_zip = new JSZip();
        new_zip.loadAsync(epubContent)
            .then(function (zip) {
                Object.keys(zip.files).forEach(function (filename) {
                    if (!(filename.includes("cover") || filename.includes("toc") || filename.includes("nav")) && filename.endsWith('html')) {
                        zip.files[filename].async('string').then(function (content) {
                            var text = extractTextFromHTML(content);
                            document.getElementById('text-input').value += removeWhitespace(filterUnwantedContent(text)) + '\n';
                            calculateCost();
                        });
                    }
                });
            });
    }

    function extractTextFromHTML(htmlContent) {
        var tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlContent;

        // Remove elements with epub:type="pagebreak"
        var pageBreaks = tempDiv.querySelectorAll('[epub\\:type="pagebreak"]');
        pageBreaks.forEach(function (elem) {
            elem.parentNode.removeChild(elem);
        });

        return tempDiv.textContent || tempDiv.innerText || '';
    }

    function filterUnwantedContent(text) {
        // Remove page numbers and bibliographies
        // Adjust these regex patterns as needed based on the actual content structure
        var filteredText = text.replace(/Page_[0-9]+\s*[0-9]+/g, ''); // Remove page numbers
        filteredText = filteredText.replace(/BIBLIOGRAPHY[\s\S]*?INTRODUCTORY/g, ''); // Remove bibliography section

        return filteredText;
    }

    function removeWhitespace(text) {
        return text.replace(/\s+/g, ' ').trim();
    }
});

function cleanPDFText(text) {
    console.log('Text before cleaning:', text); // See what we're getting
    const cleaned = text
        .replace(/\s+/g, ' ')
        .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
        .replace(/\n\s*\d+\s*\n/g, '\n')
        .replace(/^\s*(.+?)\s*\n{2,}/gm, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    console.log('Text after cleaning:', cleaned); // See what we're producing
    return cleaned;
}