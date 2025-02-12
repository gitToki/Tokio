import {
  networks,
  payments,
  Psbt,
  script as bscript,
  Signer,
} from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';

const ECPair = ECPairFactory(ecc);

/**
 * Interface personnalisée pour les paires de clés Bitcoin
 * l'interface assure la compatibilité avec le type Signer de bitcoinjs-lib
 * tout en garantissant que nous avons accès aux méthodes nécessaires pour
 * la signature et la vérification.
 */
interface BTCKeyPair extends Signer {
  publicKey: Buffer;
  sign(hash: Buffer): Buffer;
  verify(hash: Buffer, signature: Buffer): boolean;
}

/**
 * Interface définissant les paramètres nécessaires pour créer un HTLC
 * @property secretHash - Hash du secret qui déverrouillera les fonds
 * @property recipientPublicKey - Clé publique du destinataire qui peut réclamer avec le secret
 * @property refundPublicKey - Clé publique de l'expéditeur pour le remboursement
 * @property timelock - Timestamp après lequel l'expéditeur peut récupérer les fonds
 */
export interface HTLCDetails {
  secretHash: Buffer;
  recipientPublicKey: Buffer;
  refundPublicKey: Buffer;
  timelock: number;
}

/**
 * Classe principale implémentant le Hash Time Locked Contract (HTLC) pour Bitcoin
 * Cette classe permet de créer et gérer des contrats HTLC qui sont utilisés dans les atomic swaps
 */
export class BitcoinHTLC {
  private network: typeof networks.bitcoin | typeof networks.testnet;

  constructor(isTestnet: boolean = false) {
    this.network = isTestnet ? networks.testnet : networks.bitcoin;
  }

  /**
   * Crée une nouvelle paire de clés Bitcoin sécurisée
   *  Cette méthode génère des clés cryptographiques qui doivent être stockées de manière sécurisée
   * @returns Une paire de clés Bitcoin correctement typée
   */
  public static createKeyPair(): BTCKeyPair {
    const keyPair = ECPair.makeRandom();
    return {
      publicKey: Buffer.from(keyPair.publicKey),
      sign: (hash: Buffer) => {
        const signature = keyPair.sign(hash);
        return Buffer.from(signature);
      },
      verify: (hash: Buffer, signature: Buffer) => {
        return keyPair.verify(hash, signature);
      }
    };
  }

  /**
   * Crée le script Bitcoin qui implémente la logique du HTLC
   * ! Ce script est le coeur du HTLC. Il définit deux chemins d'exécution:
   * 1. Chemin de réclamation: Le destinataire peut réclamer les fonds en fournissant le secret
   * 2. Chemin de remboursement: L'expéditeur peut récupérer les fonds après le timelock
   */
  public createHTLCScript({
    secretHash,
    recipientPublicKey,
    refundPublicKey,
    timelock,
  }: HTLCDetails): Buffer {
    // If / Else pour les deux chemins
    return bscript.compile([
      bscript.OPS.OP_IF,
        // Chemin de réclamation
        bscript.OPS.OP_SHA256,        // Hash l'entrée fournie
        secretHash,                    // Compare avec le hash stocké
        bscript.OPS.OP_EQUALVERIFY,   // Vérifie que les hash correspondent
        recipientPublicKey,           // Vérifie que c'est le bon destinataire
        bscript.OPS.OP_CHECKSIG,      // Vérifie la signature
      bscript.OPS.OP_ELSE,
        // Chemin de remboursement
        bscript.number.encode(timelock), // Vérifie le timelock
        bscript.OPS.OP_CHECKLOCKTIMEVERIFY,
        bscript.OPS.OP_DROP,
        refundPublicKey,              // Vérifie que c'est l'expéditeur
        bscript.OPS.OP_CHECKSIG,      // Vérifie la signature
      bscript.OPS.OP_ENDIF,
    ]);
  }

  /**
   * Genere une adresse Bitcoin basée sur le script HTLC
   * Cette adresse utilise P2WSH pour compatibilité SegWit
   */
  public createHTLCAddress(htlcScript: Buffer): string {
    const p2wsh = payments.p2wsh({
      redeem: { output: htlcScript, network: this.network },
      network: this.network,
    });

    if (!p2wsh.address) throw new Error("Couldn't generate address");
    return p2wsh.address;
  }

  /**
   * Crée la transaction qui verrouille les fonds dans le HTLC
   * Cette transaction est la première étape de l'atomic swap
   * Elle envoie les fonds à l'adresse HTLC où ils seront verrouillés
   */
  public createFundingTransaction(
    htlcAddress: string,
    amount: number,
    utxo: {
      txid: string;
      vout: number;
      value: number;
    },
    keyPair: BTCKeyPair
  ): string {
    const psbt = new Psbt({ network: this.network });

    // Ajoute l'UTXO comme entrée
    psbt.addInput({
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: payments.p2wpkh({
          pubkey: keyPair.publicKey,
          network: this.network,
        }).output!,
        value: utxo.value,
      }
    });

    // Envoie les fonds à l'adresse HTLC
    psbt.addOutput({
      address: htlcAddress,
      value: amount,
    });

    psbt.signInput(0, keyPair);
    psbt.finalizeAllInputs();

    return psbt.extractTransaction().toHex();
  }

  /**
   * Crée la transaction de réclamation qui permet au destinataire de récupérer les fonds
   * Cette transaction révèle le secret, permettant la finalisation de l'atomic swap
   * Le secret révélé pourra être utilisé par l'autre partie pour réclamer ses fonds sur l'autre chaîne
   */
  public createClaimTransaction(
    htlcScript: Buffer,
    htlcTxId: string,
    outputIndex: number,
    amount: number,
    destinationAddress: string,
    secret: Buffer,
    recipientKeyPair: BTCKeyPair,
    feeAmount: number = 1000
  ): string {
    const psbt = new Psbt({ network: this.network });
    
    // Configure l'entrée HTLC
    const p2wsh = payments.p2wsh({
      redeem: { output: htlcScript, network: this.network },
      network: this.network,
    });

    psbt.addInput({
      hash: htlcTxId,
      index: outputIndex,
      witnessUtxo: {
        script: p2wsh.output!,
        value: amount,
      },
      witnessScript: htlcScript
    });

    // Envoie les fonds à l'adresse de destination
    psbt.addOutput({
      address: destinationAddress,
      value: amount - feeAmount
    });

    psbt.signInput(0, recipientKeyPair);

    // Construction du témoin qui révèle le secret
    psbt.finalizeInput(0, () => {
      const signature = psbt.data.inputs[0].partialSig![0].signature;
      
      return {
        finalScriptWitness: Buffer.concat([
          Buffer.from([signature.length]),
          signature,           // Signature du destinataire
          Buffer.from([secret.length]),
          secret,             // Révélation du secret
          Buffer.from([1]),   // OP_TRUE pour suivre le chemin IF
          Buffer.from([htlcScript.length]),
          htlcScript         // Script HTLC complet
        ])
      };
    });

    return psbt.extractTransaction().toHex();
  }

  /**
   * Crée la transaction de remboursement qui permet à l'expéditeur de récupérer ses fonds
   * Cette transaction ne peut être valide qu'après l'expiration du timelock
   * Elle sert de mécanisme de sécurité si l'atomic swap n'est pas complété
   */
  public createRefundTransaction(
    htlcScript: Buffer,
    htlcTxId: string,
    outputIndex: number,
    amount: number,
    refundAddress: string,
    refundKeyPair: BTCKeyPair,
    feeAmount: number = 3600, // Similaire au HTLC sur ETH
    locktime: number
  ): string {
    const psbt = new Psbt({ network: this.network });
    
    const p2wsh = payments.p2wsh({
      redeem: { output: htlcScript, network: this.network },
      network: this.network,
    });

    // Config l'entrée avec sequence pour RBF
    psbt.addInput({
      hash: htlcTxId,
      index: outputIndex,
      witnessUtxo: {
        script: p2wsh.output!,
        value: amount,
      },
      witnessScript: htlcScript,
      sequence: 0xfffffffe  // Active Replace-By-Fee
    });

    psbt.addOutput({
      address: refundAddress,
      value: amount - feeAmount
    });

    // Définit le locktime pour que la transaction ne soit valide qu'après expiration
    psbt.setLocktime(locktime);
    psbt.signInput(0, refundKeyPair);

    // Construction du témoin pour le chemin de remboursement
    psbt.finalizeInput(0, () => {
      const signature = psbt.data.inputs[0].partialSig![0].signature;
      
      return {
        finalScriptWitness: Buffer.concat([
          Buffer.from([signature.length]),
          signature,         // Signature de l'expéditeur
          Buffer.from([0]), // OP_FALSE pour suivre le chemin ELSE
          Buffer.from([htlcScript.length]),
          htlcScript       // Script HTLC complet
        ])
      };
    });

    return psbt.extractTransaction().toHex();
  }
}