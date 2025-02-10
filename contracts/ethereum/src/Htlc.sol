// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;
import { console} from "../lib/forge-std/src/Test.sol";


contract Htlc {


    struct Swap {
        address payable owner;
        address payable claimer;
        bytes32 secretHash;
        uint256 amount;
        uint256 lockTime;
    }

    struct Transaction {
        address payable claimer;
        uint256 amount;
        bytes32 secretHash;
        string dehashedSecret;
    }

    uint256 public timeLock = 3600;
    address payable owner;
    bytes32 public swapId;
    bool swapOccured = false;

    mapping (bytes32 => Swap) public swaps;
    mapping (bytes32 => Transaction) public withdraw;


    event swapInitiated(bytes32 swapID, address indexed owner, address indexed claimer, uint256 amount, uint256 lockTime, bytes32 secretHash);
    event fundsWithdraw(bytes32 swapID, address indexed claimer, bytes32 indexed secretHash, string dehashedSecret);
    event timeWithdrawEvent(bytes32 swapID, address owner, uint256 amount);

    constructor(){
        owner = payable(msg.sender);
    }

    function initiateSwap(bytes32 secret, address payable claimer) public payable {
        require(msg.value > 0, "0 ETH deposited");
        require(swapOccured == false, "The swap have already been initiated");

        swapOccured = true;
        swapId = keccak256(abi.encodePacked(claimer));
        // keccak256(abi.encodePacked(msg.sender, claimer, msg.value, block.timestamp));
        swaps[swapId] = Swap({
            owner: payable(msg.sender),
            claimer: payable(claimer),
            secretHash: secret,
            amount: msg.value,
            lockTime: block.timestamp + timeLock
        });
            
        emit swapInitiated(swapId, msg.sender, claimer, msg.value, block.timestamp + timeLock, secret);

    }





    function withdrawFunds(string calldata dehashedSecret) public payable{
        Swap storage swap = swaps[swapId];
        require(keccak256(abi.encodePacked(dehashedSecret)) == swap.secretHash, "Wrong secret");
        require(address(this).balance > 0, "0 ETH on the HTLC contract");

        uint256 amount = address(this).balance;

        bytes32 withdrawId = keccak256(abi.encodePacked(msg.sender, address(this).balance, block.timestamp));


        payable(msg.sender).transfer(address(this).balance);


        withdraw[withdrawId] = Transaction({
        claimer: payable(msg.sender),
        amount: amount,
        secretHash: swap.secretHash,
        dehashedSecret: dehashedSecret
        });
        emit fundsWithdraw(swapId, msg.sender, swap.secretHash, dehashedSecret);
    }

    function timeWithdraw() public payable{
        Swap storage swap = swaps[swapId];
        require(block.timestamp >= swap.lockTime, "Please wait at least 1 hour since the initiation of the swap");
        require(msg.sender == swap.owner, "Only the owner can withdraw the funds");
        owner.transfer(address(this).balance);

        emit timeWithdrawEvent(swapId, msg.sender, swap.amount);
    }


    }


