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


interface BTCKeyPair extends Signer {
  publicKey: Buffer;
  sign(hash: Buffer): Buffer;
  verify(hash: Buffer, signature: Buffer): boolean;
}


export interface HTLCDetails {
  secretHash: Buffer;
  recipientPublicKey: Buffer;
  refundPublicKey: Buffer;
  timelock: number;
}


export class BitcoinHTLC {
  private network: typeof networks.bitcoin | typeof networks.testnet;

  constructor(isTestnet: boolean = false) {
    this.network = isTestnet ? networks.testnet : networks.bitcoin;
  }


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


  public createHTLCScript({
    secretHash,
    recipientPublicKey,
    refundPublicKey,
    timelock,
  }: HTLCDetails): Buffer {

    return bscript.compile([
      bscript.OPS.OP_IF,
        bscript.OPS.OP_SHA256,       
        secretHash,                    
        bscript.OPS.OP_EQUALVERIFY,   
        recipientPublicKey,           
        bscript.OPS.OP_CHECKSIG,     
      bscript.OPS.OP_ELSE,

        bscript.number.encode(timelock), 
        bscript.OPS.OP_CHECKLOCKTIMEVERIFY,
        bscript.OPS.OP_DROP,
        refundPublicKey,            
        bscript.OPS.OP_CHECKSIG,    
      bscript.OPS.OP_ENDIF,
    ]);
  }


  public createHTLCAddress(htlcScript: Buffer): string {
    const p2wsh = payments.p2wsh({
      redeem: { output: htlcScript, network: this.network },
      network: this.network,
    });

    if (!p2wsh.address) throw new Error("Couldn't generate address");
    return p2wsh.address;
  }


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


    psbt.addOutput({
      address: htlcAddress,
      value: amount,
    });

    psbt.signInput(0, keyPair);
    psbt.finalizeAllInputs();

    return psbt.extractTransaction().toHex();
  }


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


    psbt.addOutput({
      address: destinationAddress,
      value: amount - feeAmount
    });

    psbt.signInput(0, recipientKeyPair);


    psbt.finalizeInput(0, () => {
      const signature = psbt.data.inputs[0].partialSig![0].signature;
      
      return {
        finalScriptWitness: Buffer.concat([
          Buffer.from([signature.length]),
          signature,        
          Buffer.from([secret.length]),
          secret,           
          Buffer.from([1]),   
          Buffer.from([htlcScript.length]),
          htlcScript        
        ])
      };
    });

    return psbt.extractTransaction().toHex();
  }

  public createRefundTransaction(
    htlcScript: Buffer,
    htlcTxId: string,
    outputIndex: number,
    amount: number,
    refundAddress: string,
    refundKeyPair: BTCKeyPair,
    feeAmount: number = 3600, 
    locktime: number
  ): string {
    const psbt = new Psbt({ network: this.network });
    
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
      witnessScript: htlcScript,
      sequence: 0xfffffffe  
    });

    psbt.addOutput({
      address: refundAddress,
      value: amount - feeAmount
    });


    psbt.setLocktime(locktime);
    psbt.signInput(0, refundKeyPair);


    psbt.finalizeInput(0, () => {
      const signature = psbt.data.inputs[0].partialSig![0].signature;
      
      return {
        finalScriptWitness: Buffer.concat([
          Buffer.from([signature.length]),
          signature,        
          Buffer.from([0]), 
          Buffer.from([htlcScript.length]),
          htlcScript      
        ])
      };
    });

    return psbt.extractTransaction().toHex();
  }
}