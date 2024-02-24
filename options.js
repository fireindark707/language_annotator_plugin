document.getElementById('save').addEventListener('click', function() {
    const sourceLang = document.getElementById('sourceLang').value;
    chrome.storage.sync.set({sourceLang: sourceLang}, function() {
        console.log('Source language saved:', sourceLang);
    });
});