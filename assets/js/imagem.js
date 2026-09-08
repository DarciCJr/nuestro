// Preparo da foto antes de enviar para a API: reduz o lado maior para 1568 px
// (limite recomendado pela Anthropic) e converte para base64 sem o prefixo data:.

const LADO_MAXIMO = 1568;

export async function prepararImagem(arquivo) {
  if (!arquivo) throw new Error('Selecione uma imagem.');
  if (!arquivo.type.startsWith('image/')) throw new Error('O arquivo selecionado não é uma imagem.');

  const bitmap = await criarBitmap(arquivo);
  const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close?.();

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  return {
    tipo: 'image/jpeg',
    base64: dataUrl.split(',')[1],
    dataUrl,
    largura,
    altura,
  };
}

function criarBitmap(arquivo) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(arquivo);
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a imagem.'));
    };
    img.src = url;
  });
}
